"""HTTP routes for the Sonora precipitation prediction service."""

from __future__ import annotations

import logging
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from threading import Lock

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
                        monthly_data["Lon"], monthly_data["Lat"], values
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
