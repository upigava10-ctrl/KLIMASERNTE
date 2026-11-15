"""Train and evaluate the three-month-ahead Sonora precipitation model."""

from pathlib import Path

import pandas as pd
from catboost import CatBoostRegressor

try:
    from .data_processor import (
        MONTHLY_EVALUATION_DIRECTORY,
        MONTHLY_TRAINING_DIRECTORY,
    )
    from .model_schema import MODEL_FEATURES, TARGET_COLUMN
except ImportError:
    from data_processor import MONTHLY_EVALUATION_DIRECTORY, MONTHLY_TRAINING_DIRECTORY
    from model_schema import MODEL_FEATURES, TARGET_COLUMN

MODEL_PATH = Path(__file__).parent / "data" / "catboost_next_3_months_model.cbm"


def load_monthly_split(directory: Path, split_name: str) -> pd.DataFrame:
    """Load a labeled monthly split and validate its model schema."""
    files = sorted(directory.glob("*.parquet"))
    if not files:
        raise FileNotFoundError(f"No {split_name} monthly Parquet files in {directory}.")

    frame = pd.concat((pd.read_parquet(file) for file in files), ignore_index=True)
    required = {*MODEL_FEATURES, TARGET_COLUMN}
    missing = required.difference(frame.columns)
    if missing:
        raise ValueError(
            f"{split_name} data is missing columns: " + ", ".join(sorted(missing))
        )
    if frame[TARGET_COLUMN].isna().any():
        raise ValueError(f"{split_name} target contains missing values.")
    return frame


def train_model() -> CatBoostRegressor:
    """Fit the monthly model, report validation RMSE, and save the artifact."""
    training = load_monthly_split(MONTHLY_TRAINING_DIRECTORY, "training")
    validation = load_monthly_split(MONTHLY_EVALUATION_DIRECTORY, "validation")

    model = CatBoostRegressor(
        iterations=600,
        learning_rate=0.05,
        depth=8,
        loss_function="RMSE",
        eval_metric="RMSE",
        random_seed=42,
        verbose=100,
        allow_writing_files=False,
    )
    model.fit(
        training[MODEL_FEATURES],
        training[TARGET_COLUMN],
        eval_set=(validation[MODEL_FEATURES], validation[TARGET_COLUMN]),
        early_stopping_rounds=80,
        use_best_model=True,
    )

    validation_predictions = model.predict(validation[MODEL_FEATURES])
    rmse = ((validation_predictions - validation[TARGET_COLUMN]) ** 2).mean() ** 0.5
    print(
        f"Validation RMSE: {rmse:.6f}; "
        f"best iteration: {model.get_best_iteration()}"
    )

    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    model.save_model(MODEL_PATH)
    print(f"Saved three-month model to {MODEL_PATH}")
    return model


if __name__ == "__main__":
    train_model()
