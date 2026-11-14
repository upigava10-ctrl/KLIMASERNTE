"""Extract Sonora GPM IMERG precipitation and join NASADEM elevation samples."""

from __future__ import annotations

from collections.abc import Callable, Iterable, Sequence
from pathlib import Path
from typing import TypeAlias

import earthaccess
import numpy as np
import pandas as pd
import xarray as xr

SONORA_BOUNDS = (-115.1, 26.2, -108.4, 32.5)
IMERG_DOI = "10.5067/GPM/IMERGDL/DAY/07"
IMERG_VARIABLES = (
    "precipitation",
    "randomError",
    "probabilityLiquidPrecipitation",
    "precipitationQualityIndex",
    "precipitation_cnt",
    "precipitation_cnt_cond",
    "MWprecipitation",
    "MWprecipitation_cnt",
    "MWprecipitation_cnt_cond",
    "randomError_cnt",
)
REQUIRED_IMERG_VARIABLES = (
    "precipitation",
    "randomError",
    "probabilityLiquidPrecipitation",
)

Bounds: TypeAlias = tuple[float, float, float, float]
Coordinate: TypeAlias = tuple[float, float]
ElevationSampler: TypeAlias = Callable[[np.ndarray], Sequence[float]]
DataSource: TypeAlias = str | Path | Iterable[str | Path]


def _validate_bounds(bounds: Bounds) -> None:
    """Validate a geographic bounding box in west/south/east/north order.

    Raises:
        ValueError: If the bounds are outside valid longitude/latitude ranges
            or west/east and south/north are not in ascending order.
    """
    west, south, east, north = bounds
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
        raise ValueError(
            "bounds must be (west, south, east, north) in longitude/latitude "
            "order, with west < east and south < north"
        )


def download_imerg_data(
    start_date: str | None = None,
    end_date: str | None = None,
    *,
    output_directory: str | Path = Path(__file__).parent / "data" / "imerg",
    bounds: Bounds = SONORA_BOUNDS,
    count: int = 10,
) -> list[Path]:
    """Search and download IMERG Late Daily files covering Sonora.

    Args:
        start_date: Inclusive beginning of the date range. Must be provided
            together with ``end_date``.
        end_date: Inclusive end of the date range. Date-only values cover the
            full day.
        output_directory: Folder where Earthaccess stores downloaded granules.
        bounds: Search area as (west, south, east, north).
        count: Maximum number of granules; use -1 for no result limit. The
            default limits downloads to a small batch.

    Returns:
        Paths to downloaded granule files, or an empty list if no results match.

    Raises:
        ValueError: If the dates, bounds, or count are invalid.
    """
    _validate_bounds(bounds)
    if (start_date is None) != (end_date is None):
        raise ValueError("Provide both start_date and end_date, or neither")
    if count == 0 or count < -1:
        raise ValueError("count must be a positive number or -1 for no limit")

    search_options: dict[str, object] = {
        "doi": IMERG_DOI,
        "bounding_box": bounds,
    }
    if start_date is not None and end_date is not None:
        if pd.Timestamp(start_date) > pd.Timestamp(end_date):
            raise ValueError("start_date must be earlier than or equal to end_date")
        search_options["temporal"] = (start_date, end_date)

    earthaccess.login()
    granules = earthaccess.search_data(count=count, **search_options)
    if not granules:
        return []

    directory = Path(output_directory)
    directory.mkdir(parents=True, exist_ok=True)
    return [
        Path(path)
        for path in earthaccess.download(granules, local_path=str(directory))
    ]


def _resolve_imerg_files(source: DataSource) -> list[Path]:
    """Expand file and directory inputs into unique, validated IMERG files.

    Directories are searched recursively. Supported extensions are HDF5 and
    NetCDF. Raises ``FileNotFoundError`` for missing paths or empty directories.
    """
    if isinstance(source, (str, Path)):
        path = Path(source)
        files = _find_imerg_files(path) if path.is_dir() else [path]
    else:
        files = []
        for item in source:
            path = Path(item)
            files.extend(_find_imerg_files(path) if path.is_dir() else [path])

    missing_files = [path for path in files if not path.is_file()]
    if missing_files:
        raise FileNotFoundError(f"IMERG file not found: {missing_files[0]}")

    unique_files = list(dict.fromkeys(files))
    if not unique_files:
        raise FileNotFoundError("No IMERG HDF5 or NetCDF files were found")
    return unique_files


def _find_imerg_files(directory: Path) -> list[Path]:
    """Find supported IMERG HDF5 and NetCDF files below ``directory``."""
    extensions = ("*.HDF5", "*.h5", "*.nc4", "*.nc")
    return sorted(
        file
        for extension in extensions
        for file in directory.rglob(extension)
    )


def _pandas_times(values: Iterable[object]) -> pd.DatetimeIndex:
    """Convert xarray/cftime timestamps to timezone-naive Pandas timestamps.

    Args:
        values: Timestamp values from an xarray coordinate or dataframe column.

    Returns:
        A Pandas ``DatetimeIndex`` suitable for filtering and CSV output.
    """
    return pd.DatetimeIndex(pd.to_datetime([str(value) for value in values]))


def _inclusive_date_range(
    start_date: str, end_date: str
) -> tuple[pd.Timestamp, pd.Timestamp]:
    """Parse date limits, including the full day for date-only end values.

    Args:
        start_date: Inclusive start date/time.
        end_date: Inclusive end date/time; an ISO date without a time includes
            the remainder of that date.

    Returns:
        Parsed start and end timestamps.
    """
    start = pd.Timestamp(start_date)
    end = pd.Timestamp(end_date)
    if len(end_date.strip()) == 10:
        end += pd.Timedelta(days=1) - pd.Timedelta(nanoseconds=1)
    return start, end


def _select_imerg_subset(
    dataset: xr.Dataset,
    bounds: Bounds,
    coordinates: Sequence[Coordinate] | None,
    start_date: str | None,
    end_date: str | None,
) -> xr.Dataset:
    """Select required precipitation fields for a bbox or nearest point list.

    Args:
        dataset: Open IMERG dataset containing time, longitude, and latitude.
        bounds: Spatial bounding box used when ``coordinates`` is omitted.
        coordinates: Optional (longitude, latitude) pairs, snapped to nearest
            IMERG grid cells.
        start_date: Optional inclusive start date/time.
        end_date: Optional inclusive end date/time.

    Returns:
        The requested spatial-temporal subset loaded into memory.

    Raises:
        ValueError: If required precipitation fields are missing or coordinates
            are invalid.
    """
    missing_variables = set(REQUIRED_IMERG_VARIABLES).difference(dataset.variables)
    if missing_variables:
        raise ValueError(
            "IMERG file is missing required precipitation variables: "
            + ", ".join(sorted(missing_variables))
        )

    available_variables = [
        variable for variable in IMERG_VARIABLES if variable in dataset.variables
    ]
    subset = dataset[available_variables]
    if coordinates is not None:
        if not coordinates:
            raise ValueError("coordinates must contain at least one (lon, lat) pair")
        points = np.asarray(coordinates, dtype=float)
        if points.ndim != 2 or points.shape[1] != 2:
            raise ValueError("coordinates must be a sequence of (longitude, latitude) pairs")
        if (
            np.any(~np.isfinite(points))
            or np.any(np.abs(points[:, 0]) > 180)
            or np.any(np.abs(points[:, 1]) > 90)
        ):
            raise ValueError("coordinates must be finite longitude/latitude values")

        subset = subset.sel(
            lon=xr.DataArray(points[:, 0], dims="location"),
            lat=xr.DataArray(points[:, 1], dims="location"),
            method="nearest",
        )
    else:
        west, south, east, north = bounds
        subset = subset.sel(lon=slice(west, east), lat=slice(south, north))

    if start_date is not None and end_date is not None:
        times = _pandas_times(subset["time"].values)
        start, end = _inclusive_date_range(start_date, end_date)
        time_mask = (times >= start) & (times <= end)
        subset = subset.isel(time=np.flatnonzero(time_mask))

    return subset.load()


def extract_imerg_dataframe(
    source: DataSource,
    *,
    bounds: Bounds = SONORA_BOUNDS,
    coordinates: Sequence[Coordinate] | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
) -> pd.DataFrame:
    """Extract IMERG fields into one row per time and IMERG grid location.

    When ``coordinates`` are supplied, each pair is snapped to its nearest
    IMERG grid cell. Otherwise the Sonora bounding box is selected. Daily and
    half-hourly supported IMERG files can both be read; optional variables are
    included when present in the input files.

    Args:
        source: A single IMERG file, a directory, or an iterable of paths.
        bounds: Bounding box used when explicit coordinates are not supplied.
        coordinates: Optional (longitude, latitude) pairs.
        start_date: Optional inclusive start date/time; provide with
            ``end_date``.
        end_date: Optional inclusive end date/time; date-only values include
            the whole day.

    Returns:
        A dataframe with time, coordinates, and available precipitation fields.

    Raises:
        FileNotFoundError: If no input files exist.
        ValueError: If dates, bounds, or input data are invalid.
    """
    _validate_bounds(bounds)
    if (start_date is None) != (end_date is None):
        raise ValueError("Provide both start_date and end_date, or neither")
    if start_date is not None and end_date is not None:
        if pd.Timestamp(start_date) > pd.Timestamp(end_date):
            raise ValueError("start_date must be earlier than or equal to end_date")

    frames: list[pd.DataFrame] = []
    for path in _resolve_imerg_files(source):
        group = "Grid" if path.suffix.lower() in {".h5", ".hdf5"} else None
        with xr.open_dataset(path, engine="netcdf4", group=group) as dataset:
            subset = _select_imerg_subset(
                dataset, bounds, coordinates, start_date, end_date
            )
            if subset.sizes.get("time", 0) == 0:
                continue

            frame = subset.to_dataframe().reset_index()
            frame = frame.drop(columns=["location"], errors="ignore")
            frame = frame.rename(
                columns={"time": "Time", "lon": "Lon", "lat": "Lat"}
            )
            for variable in IMERG_VARIABLES:
                if variable not in frame.columns:
                    continue
                missing_value = dataset[variable].attrs.get("CodeMissingValue")
                if missing_value is not None:
                    frame[variable] = frame[variable].mask(
                        np.isclose(frame[variable], float(missing_value))
                    )
            frames.append(frame)

    if not frames:
        raise ValueError("No IMERG observations matched the requested time range")

    result = pd.concat(frames, ignore_index=True)
    result["Time"] = _pandas_times(result["Time"].values)
    result = result.drop_duplicates(subset=["Time", "Lon", "Lat"])
    return result.sort_values(["Time", "Lon", "Lat"], ignore_index=True)


def sample_nasadem_elevation(coordinates: np.ndarray) -> np.ndarray:
    """Sample NASADEM elevation in meters for an Nx2 (longitude, latitude) array.

    Args:
        coordinates: Array whose rows contain longitude and latitude.

    Returns:
        One elevation in meters for each coordinate, in input order.

    Raises:
        ValueError: If the input shape is invalid or NASADEM returns a different
            number of elevations than requested.
    """
    from NASADEM import NASADEM
    from rasters import MultiPoint, Point

    points = np.asarray(coordinates, dtype=float)
    if points.ndim != 2 or points.shape[1] != 2:
        raise ValueError("coordinates must have shape (number_of_points, 2)")
    if points.shape[0] == 0:
        return np.array([], dtype=float)

    if len(points) == 1:
        values = [NASADEM.elevation_m(Point(points[0, 0], points[0, 1]))]
    else:
        geometry = MultiPoint(points.tolist())
        values = NASADEM.elevation_m(geometry)

    elevations = np.asarray(values, dtype=float).reshape(-1)
    if len(elevations) != len(points):
        raise ValueError(
            f"NASADEM returned {len(elevations)} elevations for {len(points)} locations"
        )
    return elevations


def join_nasadem_elevation(
    precipitation: pd.DataFrame,
    *,
    elevation_sampler: ElevationSampler = sample_nasadem_elevation,
) -> pd.DataFrame:
    """Add NASADEM elevations, sampling each unique IMERG location only once.

    ``elevation_sampler`` can be supplied for offline use or testing; it takes
    an Nx2 NumPy array of longitude/latitude pairs and returns elevations in m.

    Args:
        precipitation: IMERG dataframe with ``Lon``, ``Lat``, and required
            precipitation fields.
        elevation_sampler: Function that samples an Nx2 longitude/latitude
            array and returns elevations in meters.

    Returns:
        A dataframe with elevation joined to each precipitation observation.

    Raises:
        ValueError: If required columns are absent, the dataframe is empty, or
            the sampler returns a mismatched number of elevations.
    """
    required = {"Lon", "Lat", *REQUIRED_IMERG_VARIABLES}
    missing = required.difference(precipitation.columns)
    if missing:
        raise ValueError(
            "Precipitation dataframe is missing columns: " + ", ".join(sorted(missing))
        )
    if precipitation.empty:
        raise ValueError("Cannot join elevation to an empty precipitation dataframe")

    locations = precipitation[["Lon", "Lat"]].drop_duplicates(ignore_index=True)
    coordinates = locations.to_numpy(dtype=float)
    elevations = np.asarray(elevation_sampler(coordinates), dtype=float).reshape(-1)
    if len(elevations) != len(locations):
        raise ValueError(
            f"Elevation sampler returned {len(elevations)} values for "
            f"{len(locations)} unique locations"
        )

    topography = locations.assign(Elevation=elevations)
    result = precipitation.merge(topography, on=["Lon", "Lat"], how="left")
    columns = ["Lon", "Lat", "Elevation"]
    if "Time" in result.columns:
        columns.append("Time")
    columns.extend(
        variable for variable in IMERG_VARIABLES if variable in result.columns
    )
    return result[columns].sort_values(
        ["Time", "Lon", "Lat"] if "Time" in result.columns else ["Lon", "Lat"],
        ignore_index=True,
    )


def get_sonora_precipitation_dataframe(
    source: DataSource,
    *,
    coordinates: Sequence[Coordinate] | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    elevation_sampler: ElevationSampler = sample_nasadem_elevation,
) -> pd.DataFrame:
    """Extract Sonora IMERG observations and join NASADEM elevation.

    Args:
        source: A single IMERG file, a directory, or an iterable of paths.
        coordinates: Optional (longitude, latitude) pairs to extract.
        start_date: Optional inclusive start date/time; provide with
            ``end_date``.
        end_date: Optional inclusive end date/time.
        elevation_sampler: Function used to sample elevation in meters.

    Returns:
        The combined dataframe with coordinates, elevation, time, and available
        IMERG precipitation variables.
    """
    precipitation = extract_imerg_dataframe(
        source,
        bounds=SONORA_BOUNDS,
        coordinates=coordinates,
        start_date=start_date,
        end_date=end_date,
    )
    return join_nasadem_elevation(
        precipitation, elevation_sampler=elevation_sampler
    )

def write_daily_csvs(
    dataframe: pd.DataFrame,
    output_directory: str | Path,
    *,
    prefix: str = "sonora_imerg",
) -> list[Path]:
    """Write one CSV per observation date and return the generated file paths.

    Args:
        dataframe: Processed observations containing a ``Time`` column.
        output_directory: Destination folder, created if it does not exist.
        prefix: Filename prefix before the ISO date suffix.

    Returns:
        Paths to the CSV files written.

    Raises:
        ValueError: If ``Time`` is absent or the dataframe has no rows.
    """
    if "Time" not in dataframe.columns:
        raise ValueError("Dataframe must include a Time column to write daily CSVs")
    if dataframe.empty:
        raise ValueError("Cannot write an empty dataframe")

    directory = Path(output_directory)
    directory.mkdir(parents=True, exist_ok=True)
    dates = pd.to_datetime(dataframe["Time"]).dt.strftime("%Y-%m-%d")
    written_files = []
    for date, daily_frame in dataframe.groupby(dates, sort=True):
        output_path = directory / f"{prefix}_{date}.csv"
        daily_frame.to_csv(output_path, index=False)
        written_files.append(output_path)
    return written_files