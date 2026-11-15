"""Prepare Sonora IMERG CSVs as monthly feature and target Parquet files."""

from __future__ import annotations

from collections import deque
from pathlib import Path
from urllib.request import urlopen

import geopandas as gpd
import numpy as np
import pandas as pd

if __package__:
    from .gpm_precipitation import (
        IMERG_DOI,
        IMERG_VARIABLES,
        REQUIRED_IMERG_VARIABLES,
        SONORA_BOUNDS,
        download_imerg_data,
        extract_imerg_dataframe,
        get_sonora_precipitation_dataframe,
        join_nasadem_elevation,
        sample_nasadem_elevation,
        write_daily_csvs,
    )
else:
    from gpm_precipitation import (
        IMERG_DOI,
        IMERG_VARIABLES,
        REQUIRED_IMERG_VARIABLES,
        SONORA_BOUNDS,
        download_imerg_data,
        extract_imerg_dataframe,
        get_sonora_precipitation_dataframe,
        join_nasadem_elevation,
        sample_nasadem_elevation,
        write_daily_csvs,
    )

DATA_DIRECTORY = Path(__file__).parent / "data"
CSV_DIRECTORY = DATA_DIRECTORY / "sonora_precipitation"
TRAINING_DIRECTORY = DATA_DIRECTORY / "2023_2024_parquet_training"
EVALUATION_DIRECTORY = DATA_DIRECTORY / "2025_parquet_validation"
COASTLINE_URL = "https://naturalearth.s3.amazonaws.com/50m_physical/ne_50m_coastline.zip"
COASTLINE_CACHE = DATA_DIRECTORY / "geodata" / "ne_50m_coastline.zip"
TRAINING_YEARS = (2023, 2024)
EVALUATION_YEAR = 2025
DISTANCE_COLUMN = "dist_to_coast_km"
RAIN_HISTORY_COLUMN = "rained_previous_3_days"
MONTHLY_TRAINING_DIRECTORY = DATA_DIRECTORY / "2023_2024_monthly_training"
MONTHLY_EVALUATION_DIRECTORY = DATA_DIRECTORY / "2025_monthly_validation"
MONTHLY_FEATURES_DIRECTORY = DATA_DIRECTORY / "monthly_model_features"
MONTH_COLUMN = "month"
MONTHLY_RAIN_HISTORY_COLUMN = "rained_previous_3_days_days"
TARGET_COLUMN = "next_3_months_precipitation_avg"

__all__ = [
    "IMERG_DOI",
    "IMERG_VARIABLES",
    "REQUIRED_IMERG_VARIABLES",
    "SONORA_BOUNDS",
    "COASTLINE_URL",
    "DISTANCE_COLUMN",
    "RAIN_HISTORY_COLUMN",
    "MONTHLY_TRAINING_DIRECTORY",
    "MONTHLY_EVALUATION_DIRECTORY",
    "MONTHLY_FEATURES_DIRECTORY",
    "MONTHLY_RAIN_HISTORY_COLUMN",
    "TARGET_COLUMN",
    "download_imerg_data",
    "extract_imerg_dataframe",
    "get_sonora_precipitation_dataframe",
    "join_nasadem_elevation",
    "sample_nasadem_elevation",
    "write_daily_csvs",
    "coastline",
    "process_daily_csvs",
    "process_monthly_csvs",
]


def _get_coastline_source() -> Path:
    """Download and cache the Natural Earth coastline archive when needed."""
    if not COASTLINE_CACHE.exists():
        COASTLINE_CACHE.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = COASTLINE_CACHE.with_suffix(".zip.tmp")
        with urlopen(COASTLINE_URL, timeout=60) as response:
            temporary_path.write_bytes(response.read())
        temporary_path.replace(COASTLINE_CACHE)
    return COASTLINE_CACHE


def coastline(
    coordinates: pd.DataFrame,
    *,
    coastline_source: str | Path | None = None,
) -> pd.DataFrame:
    """Measure each coordinate's distance to the nearest coastline in km.

    The default source is Natural Earth's 1:50m global coastline dataset, cached
    under ``Backend/data/geodata``. Distances use EPSG:6372, a metric CRS suited
    to Mexico.

    Args:
        coordinates: DataFrame containing numeric ``Lon`` and ``Lat`` columns.
        coastline_source: Optional local coastline dataset or GeoPandas-readable
            source. If omitted, the Natural Earth archive is downloaded once.

    Returns:
        A copy of ``coordinates`` with ``dist_to_coast_km`` added.

    Raises:
        ValueError: If coordinates are missing, invalid, or the coastline source
            contains no geometries.
    """
    required = {"Lon", "Lat"}
    if not required.issubset(coordinates.columns):
        raise ValueError("Coordinates must contain Lon and Lat columns.")

    points = coordinates[["Lon", "Lat"]].drop_duplicates().copy()
    values = points[["Lon", "Lat"]].to_numpy(dtype=float)
    if (
        values.size == 0
        or not np.isfinite(values).all()
        or np.any(np.abs(values[:, 0]) > 180)
        or np.any(np.abs(values[:, 1]) > 90)
    ):
        raise ValueError("Coordinates must be finite longitude/latitude pairs.")

    source = coastline_source if coastline_source is not None else _get_coastline_source()
    coast = gpd.read_file(source)
    if coast.empty:
        raise ValueError("The coastline source contains no geometries.")
    if coast.crs is None:
        coast = coast.set_crs("EPSG:4326")

    point_geometries = gpd.GeoSeries(
        gpd.points_from_xy(points["Lon"], points["Lat"]),
        crs="EPSG:4326",
    ).to_crs(epsg=6372)
    coast_geometry = coast.to_crs(epsg=6372).geometry.union_all()
    points[DISTANCE_COLUMN] = (
        point_geometries.distance(coast_geometry).to_numpy() / 1000
    )
    return points


def _daily_csvs_by_date(csv_directory: Path) -> dict[pd.Timestamp, Path]:
    """Find supported daily CSVs and map each date to exactly one file."""
    files_by_date: dict[pd.Timestamp, Path] = {}
    for path in csv_directory.glob("sonora_imerg_*.csv"):
        date_text = path.stem.removeprefix("sonora_imerg_")
        date = pd.to_datetime(date_text, format="%Y-%m-%d", errors="raise")
        if date.year not in (*TRAINING_YEARS, EVALUATION_YEAR):
            continue
        if date in files_by_date:
            raise ValueError(f"Multiple daily CSV files found for {date.date()}.")
        files_by_date[date] = path
    return dict(sorted(files_by_date.items()))


def process_daily_csvs(
    csv_directory: str | Path = CSV_DIRECTORY,
    *,
    training_directory: str | Path = TRAINING_DIRECTORY,
    evaluation_directory: str | Path = EVALUATION_DIRECTORY,
    coastline_source: str | Path | None = None,
) -> dict[str, int]:
    """Feature-engineer daily CSVs and write year-split Parquet datasets.

    Adds a distance-to-coast feature and a boolean indicating whether any of
    the previous three calendar days had positive IMERG precipitation. The
    history carries across year boundaries. 2023 and 2024 are written to the
    training directory; 2025 is written to the evaluation directory.

    Args:
        csv_directory: Directory containing ``sonora_imerg_YYYY-MM-DD.csv``
            source files.
        training_directory: Output directory for 2023-2024 daily Parquets.
        evaluation_directory: Output directory for 2025 daily Parquets.
        coastline_source: Optional local or remote coastline dataset. If
            omitted, the Natural Earth coastline is cached locally.

    Returns:
        Number of daily Parquet files written for ``training`` and
        ``evaluation``.

    Raises:
        FileNotFoundError: If source CSVs are absent or a date is missing.
        ValueError: If a file does not contain one valid daily grid.
    """
    input_directory = Path(csv_directory)
    files_by_date = _daily_csvs_by_date(input_directory)
    expected_dates = pd.date_range("2023-01-01", "2025-12-31", freq="D")
    missing_dates = expected_dates.difference(pd.DatetimeIndex(files_by_date))
    if not missing_dates.empty:
        sample = ", ".join(date.strftime("%Y-%m-%d") for date in missing_dates[:5])
        raise FileNotFoundError(
            f"Missing {len(missing_dates)} daily CSV files; examples: {sample}"
        )

    first_frame = pd.read_csv(files_by_date[expected_dates[0]], usecols=["Lon", "Lat"])
    coast_distances = coastline(
        first_frame.drop_duplicates(ignore_index=True),
        coastline_source=coastline_source,
    )
    training_path = Path(training_directory)
    evaluation_path = Path(evaluation_directory)
    training_path.mkdir(parents=True, exist_ok=True)
    evaluation_path.mkdir(parents=True, exist_ok=True)

    recent_rain: deque[dict[tuple[float, float], bool]] = deque(maxlen=3)
    output_counts = {"training": 0, "evaluation": 0}
    for date, source_path in files_by_date.items():
        daily = pd.read_csv(source_path)
        required_columns = {"Lon", "Lat", "Time", "precipitation"}
        missing_columns = required_columns.difference(daily.columns)
        if missing_columns:
            raise ValueError(
                f"{source_path.name} is missing columns: "
                + ", ".join(sorted(missing_columns))
            )

        daily_times = pd.to_datetime(daily["Time"], errors="raise")
        if daily_times.dt.normalize().nunique() != 1 or daily_times.dt.normalize().iloc[0] != date:
            raise ValueError(f"{source_path.name} does not contain only {date.date()}.")
        if daily.duplicated(["Lon", "Lat"]).any():
            raise ValueError(f"{source_path.name} contains duplicate grid locations.")

        location_keys = list(zip(daily["Lon"], daily["Lat"]))
        rained_recently = np.zeros(len(daily), dtype=bool)
        for previous_day in recent_rain:
            rained_recently |= np.fromiter(
                (previous_day.get(location, False) for location in location_keys),
                dtype=bool,
                count=len(location_keys),
            )
        daily[RAIN_HISTORY_COLUMN] = rained_recently

        daily = daily.merge(
            coast_distances,
            on=["Lon", "Lat"],
            how="left",
            validate="many_to_one",
        )
        if daily[DISTANCE_COLUMN].isna().any():
            raise ValueError(
                f"Could not calculate coastline distance for every location in "
                f"{source_path.name}."
            )

        current_rain = daily["precipitation"].fillna(0).gt(0).to_numpy()
        recent_rain.append(dict(zip(location_keys, current_rain)))

        output_directory = (
            training_path if date.year in TRAINING_YEARS else evaluation_path
        )
        output_path = output_directory / f"{source_path.stem}.parquet"
        daily.to_parquet(output_path, compression="snappy", index=False)
        output_counts[
            "training" if date.year in TRAINING_YEARS else "evaluation"
        ] += 1

    return output_counts


def _aggregate_monthly_rows(monthly_daily: list[pd.DataFrame]) -> pd.DataFrame:
    """Aggregate one month's daily feature rows for each grid location."""
    data = pd.concat(monthly_daily, ignore_index=True)
    aggregations: dict[str, tuple[str, str]] = {}

    for column in data.columns:
        if column in {"Lon", "Lat", "Time"}:
            continue
        if column in {"Elevation", DISTANCE_COLUMN}:
            aggregations[column] = (column, "mean")
        elif column == "precipitation":
            aggregations["precipitation_mean"] = (column, "mean")
            aggregations["precipitation_sum"] = (column, "sum")
        elif column == RAIN_HISTORY_COLUMN:
            aggregations[MONTHLY_RAIN_HISTORY_COLUMN] = (column, "sum")
        elif "_cnt" in column:
            aggregations[f"{column}_sum"] = (column, "sum")
        else:
            aggregations[f"{column}_mean"] = (column, "mean")

    monthly = (
        data.groupby(["Lon", "Lat"], as_index=False)
        .agg(**aggregations)
    )
    return monthly


def process_monthly_csvs(
    csv_directory: str | Path = CSV_DIRECTORY,
    *,
    training_directory: str | Path = MONTHLY_TRAINING_DIRECTORY,
    evaluation_directory: str | Path = MONTHLY_EVALUATION_DIRECTORY,
    features_directory: str | Path = MONTHLY_FEATURES_DIRECTORY,
    coastline_source: str | Path | None = None,
) -> dict[str, int]:
    """Create one spatial row per month with a three-month-ahead target.

    Continuous variables are averaged within the input month, count variables
    and precipitation totals are summed, and the rain-history feature counts
    days whose preceding three days were wet. The target is the mean of the
    monthly mean daily precipitation in each of the next three calendar months.
    Input months in 2023-2024 are training data; months in 2025 are validation
    data. Months without all three future months are excluded.

    Args:
        csv_directory: Directory containing daily Sonora IMERG CSV files.
        training_directory: Output directory for labeled 2023-2024 monthly rows.
        evaluation_directory: Output directory for labeled 2025 monthly rows.
        features_directory: Output directory for monthly inference features,
            including months without a complete future target.
        coastline_source: Optional local or remote coastline dataset.

    Returns:
        Number of monthly Parquet files written to the training and evaluation
        directories.

    Raises:
        FileNotFoundError: If source CSVs or any expected 2023-2025 date are
            missing.
        ValueError: If daily data has an invalid date, columns, or grid.
    """
    input_directory = Path(csv_directory)
    files_by_date = _daily_csvs_by_date(input_directory)
    expected_dates = pd.date_range("2023-01-01", "2025-12-31", freq="D")
    missing_dates = expected_dates.difference(pd.DatetimeIndex(files_by_date))
    if not missing_dates.empty:
        sample = ", ".join(date.strftime("%Y-%m-%d") for date in missing_dates[:5])
        raise FileNotFoundError(
            f"Missing {len(missing_dates)} daily CSV files; examples: {sample}"
        )

    first_frame = pd.read_csv(files_by_date[expected_dates[0]], usecols=["Lon", "Lat"])
    coast_distances = coastline(
        first_frame.drop_duplicates(ignore_index=True),
        coastline_source=coastline_source,
    )
    training_path = Path(training_directory)
    evaluation_path = Path(evaluation_directory)
    features_path = Path(features_directory)
    training_path.mkdir(parents=True, exist_ok=True)
    evaluation_path.mkdir(parents=True, exist_ok=True)
    features_path.mkdir(parents=True, exist_ok=True)

    monthly_frames: list[pd.DataFrame] = []
    monthly_daily: list[pd.DataFrame] = []
    active_month: pd.Timestamp | None = None
    recent_rain: deque[dict[tuple[float, float], bool]] = deque(maxlen=3)

    for date, source_path in files_by_date.items():
        month = date.to_period("M").to_timestamp()
        if active_month is not None and month != active_month:
            monthly = _aggregate_monthly_rows(monthly_daily)
            monthly[MONTH_COLUMN] = active_month
            monthly["month_of_year"] = active_month.month
            monthly_frames.append(monthly)
            monthly_daily = []
        active_month = month

        daily = pd.read_csv(source_path)
        required_columns = {"Lon", "Lat", "Time", "precipitation"}
        missing_columns = required_columns.difference(daily.columns)
        if missing_columns:
            raise ValueError(
                f"{source_path.name} is missing columns: "
                + ", ".join(sorted(missing_columns))
            )

        daily_times = pd.to_datetime(daily["Time"], errors="raise")
        if (
            daily_times.dt.normalize().nunique() != 1
            or daily_times.dt.normalize().iloc[0] != date
        ):
            raise ValueError(f"{source_path.name} does not contain only {date.date()}.")
        if daily.duplicated(["Lon", "Lat"]).any():
            raise ValueError(f"{source_path.name} contains duplicate grid locations.")

        location_keys = list(zip(daily["Lon"], daily["Lat"]))
        rained_recently = np.zeros(len(daily), dtype=bool)
        for previous_day in recent_rain:
            rained_recently |= np.fromiter(
                (previous_day.get(location, False) for location in location_keys),
                dtype=bool,
                count=len(location_keys),
            )
        daily[RAIN_HISTORY_COLUMN] = rained_recently

        daily = daily.merge(
            coast_distances,
            on=["Lon", "Lat"],
            how="left",
            validate="many_to_one",
        )
        if daily[DISTANCE_COLUMN].isna().any():
            raise ValueError(
                f"Could not calculate coastline distance for every location in "
                f"{source_path.name}."
            )

        for column in daily.columns:
            if column not in {"Lon", "Lat", "Time"}:
                daily[column] = pd.to_numeric(daily[column], errors="coerce")

        current_rain = daily["precipitation"].fillna(0).gt(0).to_numpy()
        recent_rain.append(dict(zip(location_keys, current_rain)))
        monthly_daily.append(daily)

    if active_month is not None:
        monthly = _aggregate_monthly_rows(monthly_daily)
        monthly[MONTH_COLUMN] = active_month
        monthly["month_of_year"] = active_month.month
        monthly_frames.append(monthly)

    monthly_data = pd.concat(monthly_frames, ignore_index=True)
    if monthly_data.duplicated(["Lon", "Lat", MONTH_COLUMN]).any():
        raise ValueError("Monthly data contains duplicate location-month rows.")

    for months_ahead in (1, 2, 3):
        future = monthly_data[
            ["Lon", "Lat", MONTH_COLUMN, "precipitation_mean"]
        ].copy()
        future[MONTH_COLUMN] = future[MONTH_COLUMN] - pd.DateOffset(
            months=months_ahead
        )
        future = future.rename(
            columns={"precipitation_mean": f"_future_month_{months_ahead}"}
        )
        monthly_data = monthly_data.merge(
            future,
            on=["Lon", "Lat", MONTH_COLUMN],
            how="left",
            validate="one_to_one",
        )

    future_columns = [f"_future_month_{month}" for month in (1, 2, 3)]
    monthly_data[TARGET_COLUMN] = monthly_data[future_columns].mean(
        axis=1, skipna=False
    )

    inference_features = monthly_data.drop(
        columns=[*future_columns, TARGET_COLUMN]
    )
    for month, rows in inference_features.groupby(MONTH_COLUMN, sort=True):
        output_path = features_path / f"sonora_imerg_{month:%Y-%m}.parquet"
        rows.to_parquet(output_path, compression="snappy", index=False)

    output_counts = {"training": 0, "evaluation": 0}
    labeled_data = monthly_data.dropna(subset=[TARGET_COLUMN]).drop(
        columns=future_columns
    )
    for month, rows in labeled_data.groupby(MONTH_COLUMN, sort=True):
        output_directory = (
            training_path if month.year in TRAINING_YEARS else evaluation_path
        )
        output_path = output_directory / f"sonora_imerg_{month:%Y-%m}.parquet"
        rows.to_parquet(output_path, compression="snappy", index=False)
        output_counts[
            "training" if month.year in TRAINING_YEARS else "evaluation"
        ] += 1

    return output_counts


if __name__ == "__main__":
    counts = process_monthly_csvs()
    print(
        "Wrote "
        f"{counts['training']} monthly training Parquet files and "
        f"{counts['evaluation']} monthly validation Parquet files."
    )
