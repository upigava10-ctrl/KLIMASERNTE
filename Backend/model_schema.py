"""Shared feature and target names for monthly precipitation modeling."""

TARGET_COLUMN = "next_3_months_precipitation_avg"

MODEL_FEATURES = [
    "Lon",
    "Lat",
    "Elevation",
    "dist_to_coast_km",
    "month_of_year",
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
    "rained_previous_3_days_days",
]
