"""HTTP routes for the Sonora precipitation prediction service."""

from __future__ import annotations

import json
import logging
import os
import re
import sys
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from threading import Lock
import unicodedata

import numpy as np
import pandas as pd
from catboost import CatBoostRegressor
from flask import Flask, jsonify, request
from flask_cors import CORS

BACKEND_DIRECTORY = Path(__file__).resolve().parents[1]
if str(BACKEND_DIRECTORY) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIRECTORY))

from model_schema import MODEL_FEATURES, TARGET_COLUMN

MODEL_PATH = BACKEND_DIRECTORY / "data" / "catboost_next_3_months_model.cbm"
DATA_DIRECTORY = BACKEND_DIRECTORY / "data"
MONTHLY_FEATURES_DIRECTORY = DATA_DIRECTORY / "monthly_model_features"
MONTHLY_TRAINING_DIRECTORY = DATA_DIRECTORY / "2023_2024_monthly_training"
MONTHLY_VALIDATION_DIRECTORY = DATA_DIRECTORY / "2025_monthly_validation"
SONORA_LOCATIONS_PATH = BACKEND_DIRECTORY / "sonora_locations.json"
logger = logging.getLogger(__name__)
_model: CatBoostRegressor | None = None
_model_lock = Lock()


def _parse_month(month_text: str | None) -> pd.Period:
    """Parse a YYYY-MM month query parameter or raise a clear validation error."""
    if month_text is None or re.fullmatch(r"\d{4}-\d{2}", month_text) is None:
        raise ValueError("Provide month as YYYY-MM.")
    try:
        parsed = datetime.strptime(month_text, "%Y-%m")
    except ValueError as error:
        raise ValueError("Provide a valid calendar month as YYYY-MM.") from error
    return pd.Period(parsed, freq="M")


def _month_file(directory: Path, month: pd.Period) -> Path:
    """Return a monthly parquet path using a validated calendar month."""
    return directory / f"sonora_imerg_{month:%Y-%m}.parquet"


def _normalize_search_text(value: str) -> str:
    """Normalize accents and case for searchable Spanish place names."""
    normalized = unicodedata.normalize("NFKD", value.casefold())
    return "".join(
        character
        for character in normalized
        if not unicodedata.combining(character)
    )


@lru_cache(maxsize=1)
def _sonora_locations() -> tuple[dict[str, object], ...]:
    """Load the catalogued inland Sonora settlements and their model grid cells."""
    with SONORA_LOCATIONS_PATH.open(encoding="utf-8") as location_file:
        catalog = json.load(location_file)
    return tuple(catalog["locations"])


def _location_type(location: dict[str, object]) -> str:
    """Return a human-readable settlement category for a catalog entry."""
    name = str(location["name"]).casefold()
    feature_code = location["feature_code"]
    if feature_code == "PPLA":
        return "City"
    if feature_code in {"PPLA2", "PPLA3"}:
        return "Municipal seat"
    if feature_code == "PPLC":
        return "Capital"
    if "rancho" in name or "ranch" in name or feature_code == "RCH":
        return "Ranch/locality"
    if feature_code == "PPLX":
        return "Locality"
    return "Settlement"


def _location_grid_row(
    monthly_data: pd.DataFrame, location: dict[str, object]
) -> pd.Series:
    """Select the pre-matched Sonora IMERG grid cell for a named location."""
    longitude = float(location["grid_lon"])
    latitude = float(location["grid_lat"])
    matches = monthly_data.loc[
        np.isclose(monthly_data["Lon"], longitude, atol=1e-7)
        & np.isclose(monthly_data["Lat"], latitude, atol=1e-7)
    ]
    if len(matches) != 1:
        raise ValueError(
            f"Expected one grid cell for location {location['id']}, found {len(matches)}."
        )
    return matches.iloc[0]


def _monthly_series_point(
    month: pd.Period,
    input_month: pd.Period,
    monthly_data: pd.DataFrame,
    target_values: np.ndarray,
) -> dict[str, str | float]:
    """Reduce monthly grid values to spatial means for dashboard charts."""
    variables = (
        "precipitation_mean",
        "precipitation_sum",
        "randomError_mean",
        "probabilityLiquidPrecipitation_mean",
        "precipitation_cnt_sum",
        "precipitation_cnt_cond_sum",
        "MWprecipitation_mean",
        "MWprecipitation_cnt_sum",
        "MWprecipitation_cnt_cond_sum",
        "randomError_cnt_sum",
    )
    point: dict[str, str | float] = {
        "month": str(month),
        "input_month": str(input_month),
        "next_3_months_precipitation_avg": float(np.mean(target_values)),
    }
    for variable in variables:
        if variable in monthly_data.columns:
            point[variable] = float(monthly_data[variable].mean())
    return point


def _get_model() -> CatBoostRegressor:
    """Load the prediction model once per Flask process."""
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                model = CatBoostRegressor()
                model.load_model(MODEL_PATH)
                _model = model
    return _model


def _validate_records(payload: object) -> list[dict[str, float]]:
    """Validate prediction records and return numeric model inputs."""
    if not isinstance(payload, dict) or not isinstance(payload.get("records"), list):
        raise ValueError("JSON body must contain a 'records' array.")
    records = payload["records"]
    if not records:
        raise ValueError("'records' must contain at least one location.")

    validated: list[dict[str, float]] = []
    for index, record in enumerate(records):
        if not isinstance(record, dict):
            raise ValueError(f"Record {index} must be a JSON object.")

        missing = [feature for feature in MODEL_FEATURES if feature not in record]
        if missing:
            raise ValueError(
                f"Record {index} is missing model features: {', '.join(missing)}."
            )

        row: dict[str, float] = {}
        for feature in MODEL_FEATURES:
            value = record[feature]
            if value is None and feature == "Elevation":
                row[feature] = np.nan
                continue
            try:
                numeric_value = float(value)
            except (TypeError, ValueError) as error:
                raise ValueError(
                    f"Record {index} feature '{feature}' must be numeric."
                ) from error
            if not np.isfinite(numeric_value):
                raise ValueError(
                    f"Record {index} feature '{feature}' must be finite."
                )
            row[feature] = numeric_value

        if not -180 <= row["Lon"] <= 180 or not -90 <= row["Lat"] <= 90:
            raise ValueError(f"Record {index} has invalid longitude/latitude.")
        if not 1 <= row["month_of_year"] <= 12:
            raise ValueError(f"Record {index} month_of_year must be from 1 to 12.")
        validated.append(row)

    return validated


def register_routes(app: Flask) -> None:
    """Register health and model prediction endpoints on the Flask app."""
    origins = os.getenv(
        "FRONTEND_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000",
    ).split(",")
    CORS(app, resources={r"/api/*": {"origins": [origin.strip() for origin in origins]}})

    @app.get("/api/health")
    def health():
        return jsonify(
            {
                "status": "ok",
                "model_available": MODEL_PATH.is_file(),
                "target": TARGET_COLUMN,
            }
        )

    @app.get("/api/months")
    def available_months():
        view = request.args.get("view", "actual")
        if view == "actual":
            files = sorted(MONTHLY_TRAINING_DIRECTORY.glob("*.parquet"))
            months = [path.stem.removeprefix("sonora_imerg_") for path in files]
        elif view == "prediction":
            months = []
            for month_number in range(1, 11):
                forecast_month = pd.Period(
                    year=2025, month=month_number, freq="M"
                )
                input_month = forecast_month - 1
                if _month_file(MONTHLY_FEATURES_DIRECTORY, input_month).is_file():
                    months.append(str(forecast_month))
        else:
            return jsonify({"error": "view must be 'actual' or 'prediction'."}), 400

        return jsonify({"view": view, "months": months})

    @app.get("/api/locations")
    def search_locations():
        query = _normalize_search_text(request.args.get("q", "").strip())
        try:
            limit = min(max(int(request.args.get("limit", "30")), 1), 100)
        except ValueError:
            return jsonify({"error": "limit must be an integer."}), 400

        locations = list(_sonora_locations())
        if query:
            matching = [
                location
                for location in locations
                if query in _normalize_search_text(str(location["name"]))
                or query in str(location["municipality_code"])
            ]
            matching.sort(
                key=lambda location: (
                    not _normalize_search_text(str(location["name"])).startswith(query),
                    -int(location["population"]),
                    str(location["name"]),
                )
            )
        else:
            matching = sorted(
                locations,
                key=lambda location: (
                    -int(location["population"]),
                    str(location["name"]),
                ),
            )

        return jsonify(
            {
                "locations": [
                    {
                        "id": location["id"],
                        "name": location["name"],
                        "type": _location_type(location),
                        "municipality_code": location["municipality_code"],
                        "lat": location["lat"],
                        "lon": location["lon"],
                    }
                    for location in matching[:limit]
                ],
                "total_matches": len(matching),
                "minimum_inland_distance_km": 15,
            }
        )

    @app.get("/api/location-series")
    def location_series():
        view = request.args.get("view", "actual")
        try:
            start_month = _parse_month(request.args.get("start"))
            end_month = _parse_month(request.args.get("end"))
            location_id = int(request.args.get("location_id", ""))
        except ValueError as error:
            return jsonify({"error": str(error)}), 400

        if start_month > end_month:
            return jsonify({"error": "start must not be after end."}), 400
        location = next(
            (
                item
                for item in _sonora_locations()
                if item["id"] == location_id
            ),
            None,
        )
        if location is None:
            return jsonify({"error": "Sonora inland location was not found."}), 404

        if view == "actual":
            allowed_start = pd.Period("2023-01", freq="M")
            allowed_end = pd.Period("2024-12", freq="M")
            directory = MONTHLY_TRAINING_DIRECTORY
        elif view == "prediction":
            allowed_start = pd.Period("2025-01", freq="M")
            allowed_end = pd.Period("2025-10", freq="M")
            directory = MONTHLY_FEATURES_DIRECTORY
            if not MODEL_PATH.is_file():
                return jsonify({"error": "Prediction model is not available."}), 503
        else:
            return jsonify({"error": "view must be 'actual' or 'prediction'."}), 400

        if start_month < allowed_start or end_month > allowed_end:
            return jsonify(
                {
                    "error": (
                        f"{view} months must be between {allowed_start} "
                        f"and {allowed_end}."
                    )
                }
            ), 400

        series: list[dict[str, object]] = []
        for month in pd.period_range(start_month, end_month, freq="M"):
            input_month = month if view == "actual" else month - 1
            source_path = _month_file(directory, input_month)
            if not source_path.is_file():
                return jsonify(
                    {"error": f"Monthly data for {input_month} was not found."}
                ), 404

            monthly_data = pd.read_parquet(source_path)
            if "precipitation_mean" not in monthly_data.columns:
                return jsonify(
                    {
                        "error": (
                            f"Monthly precipitation data for {input_month} "
                            "is missing the precipitation_mean column."
                        )
                    }
                ), 500
            try:
                row = _location_grid_row(monthly_data, location)
            except ValueError as error:
                logger.exception("Could not match requested settlement to IMERG grid.")
                return jsonify({"error": str(error)}), 500

            if view == "actual":
                if TARGET_COLUMN not in row:
                    return jsonify(
                        {"error": f"Monthly target for {input_month} is missing."}
                    ), 500
                target_value = (
                    None if pd.isna(row[TARGET_COLUMN]) else float(row[TARGET_COLUMN])
                )
            else:
                missing_features = set(MODEL_FEATURES).difference(monthly_data.columns)
                if missing_features:
                    return jsonify(
                        {
                            "error": f"Monthly features for {input_month} are incomplete.",
                            "details": sorted(missing_features),
                        }
                    ), 500
                prediction_input = pd.DataFrame.from_records(
                    [{feature: row[feature] for feature in MODEL_FEATURES}],
                    columns=MODEL_FEATURES,
                )
                try:
                    target_value = max(
                        float(_get_model().predict(prediction_input)[0]), 0
                    )
                except Exception:
                    logger.exception("Could not predict settlement monthly data.")
                    return jsonify({"error": "Could not calculate location series."}), 500

            precipitation_mean = row["precipitation_mean"]
            series.append(
                {
                    "month": str(month),
                    "input_month": str(input_month),
                    "precipitation_mean": (
                        None
                        if pd.isna(precipitation_mean)
                        else float(precipitation_mean)
                    ),
                    TARGET_COLUMN: target_value,
                }
            )

        return jsonify(
            {
                "view": view,
                "location": {
                    "id": location["id"],
                    "name": location["name"],
                    "type": _location_type(location),
                    "lat": location["lat"],
                    "lon": location["lon"],
                },
                "series": series,
            }
        )

    @app.get("/api/series")
    def monthly_series():
        view = request.args.get("view", "actual")
        try:
            start_month = _parse_month(request.args.get("start"))
            end_month = _parse_month(request.args.get("end"))
        except ValueError as error:
            return jsonify({"error": str(error)}), 400
        if start_month > end_month:
            return jsonify({"error": "start must not be after end."}), 400

        if view == "actual":
            allowed_start = pd.Period("2023-01", freq="M")
            allowed_end = pd.Period("2024-12", freq="M")
        elif view == "prediction":
            allowed_start = pd.Period("2025-01", freq="M")
            allowed_end = pd.Period("2025-10", freq="M")
        else:
            return jsonify({"error": "view must be 'actual' or 'prediction'."}), 400

        if start_month < allowed_start or end_month > allowed_end:
            return jsonify(
                {
                    "error": (
                        f"{view} months must be between {allowed_start} "
                        f"and {allowed_end}."
                    )
                }
            ), 400

        if view == "prediction" and not MODEL_PATH.is_file():
            return jsonify({"error": "Prediction model is not available."}), 503

        series: list[dict[str, str | float]] = []
        for month in pd.period_range(start_month, end_month, freq="M"):
            input_month = month if view == "actual" else month - 1
            directory = (
                MONTHLY_TRAINING_DIRECTORY
                if view == "actual"
                else MONTHLY_FEATURES_DIRECTORY
            )
            source_path = _month_file(directory, input_month)
            if not source_path.is_file():
                return jsonify(
                    {"error": f"Monthly data for {input_month} was not found."}
                ), 404

            monthly_data = pd.read_parquet(source_path)
            if view == "actual":
                if TARGET_COLUMN not in monthly_data:
                    return jsonify(
                        {"error": f"Monthly target for {input_month} is missing."}
                    ), 500
                target_values = monthly_data[TARGET_COLUMN].to_numpy(dtype=float)
            else:
                missing_features = set(MODEL_FEATURES).difference(
                    monthly_data.columns
                )
                if missing_features:
                    return jsonify(
                        {
                            "error": f"Monthly features for {input_month} are incomplete.",
                            "details": sorted(missing_features),
                        }
                    ), 500
                try:
                    target_values = np.maximum(
                        _get_model().predict(monthly_data[MODEL_FEATURES]), 0
                    )
                except Exception:
                    logger.exception("Could not calculate monthly chart predictions.")
                    return jsonify({"error": "Could not calculate chart series."}), 500

            series.append(
                _monthly_series_point(
                    month, input_month, monthly_data, target_values
                )
            )

        return jsonify({"view": view, "series": series})

    @app.get("/api/monthly")
    def monthly_map_data():
        view = request.args.get("view", "actual")
        try:
            requested_month = _parse_month(request.args.get("month"))
        except ValueError as error:
            return jsonify({"error": str(error)}), 400

        if view == "actual":
            if requested_month.year not in (2023, 2024):
                return jsonify(
                    {"error": "Actual monthly targets are available for 2023-2024."}
                ), 400
            input_month = requested_month
            source_path = _month_file(MONTHLY_TRAINING_DIRECTORY, input_month)
            if not source_path.is_file():
                return jsonify({"error": "Monthly actual data was not found."}), 404
            monthly_data = pd.read_parquet(source_path)
            if TARGET_COLUMN not in monthly_data:
                return jsonify({"error": "Monthly target column is missing."}), 500
            values = monthly_data[TARGET_COLUMN].to_numpy(dtype=float)
        elif view == "prediction":
            if requested_month.year != 2025 or requested_month.month > 10:
                return jsonify(
                    {
                        "error": (
                            "2025 predictions are available for January through "
                            "October, using data through September."
                        )
                    }
                ), 400
            input_month = requested_month - 1
            source_path = _month_file(MONTHLY_FEATURES_DIRECTORY, input_month)
            if not source_path.is_file():
                return jsonify(
                    {"error": f"Input features for {input_month} were not found."}
                ), 404
            if not MODEL_PATH.is_file():
                return jsonify(
                    {
                        "error": "Prediction model is not available.",
                        "details": "Train it with Backend/catboost_train.py first.",
                    }
                ), 503
            monthly_data = pd.read_parquet(source_path)
            missing_features = set(MODEL_FEATURES).difference(monthly_data.columns)
            if missing_features:
                return jsonify(
                    {
                        "error": "Monthly features are missing model columns.",
                        "details": sorted(missing_features),
                    }
                ), 500
            try:
                values = np.maximum(
                    _get_model().predict(monthly_data[MODEL_FEATURES]), 0
                )
            except Exception:
                logger.exception("Could not predict monthly map data.")
                return jsonify({"error": "Prediction failed."}), 500
        else:
            return jsonify({"error": "view must be 'actual' or 'prediction'."}), 400

        return jsonify(
            {
                "view": view,
                "month": str(requested_month),
                "input_month": str(input_month),
                "period_start": str(requested_month if view == "prediction" else input_month + 1),
                "period_end": str(requested_month + 2 if view == "prediction" else input_month + 3),
                "target": TARGET_COLUMN,
                "records": [
                    {
                        "Lon": float(lon),
                        "Lat": float(lat),
                        TARGET_COLUMN: float(value),
                    }
                    for lon, lat, value in zip(
                        monthly_data["Lon"],
                        monthly_data["Lat"],
                        values,
                    )
                ],
            }
        )

    @app.post("/api/predict")
    def predict():
        payload = request.get_json(silent=True)
        try:
            records = _validate_records(payload)
        except ValueError as error:
            return jsonify({"error": str(error)}), 400

        if not MODEL_PATH.is_file():
            return jsonify(
                {
                    "error": "Prediction model is not available.",
                    "details": "Train it with Backend/catboost_train.py first.",
                }
            ), 503

        try:
            inputs = pd.DataFrame.from_records(records, columns=MODEL_FEATURES)
            predictions = np.maximum(_get_model().predict(inputs), 0)
        except Exception:
            logger.exception("Could not run precipitation prediction.")
            return jsonify({"error": "Prediction failed."}), 500

        return jsonify(
            {
                "target": TARGET_COLUMN,
                "predictions": [
                    {
                        "Lon": record["Lon"],
                        "Lat": record["Lat"],
                        TARGET_COLUMN: float(prediction),
                    }
                    for record, prediction in zip(records, predictions)
                ],
            }
        )
