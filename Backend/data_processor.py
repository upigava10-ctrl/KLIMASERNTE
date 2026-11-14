"""Convenient public imports for the GPM IMERG data-processing functions."""

import pandas as pd

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

__all__ = [
    "IMERG_DOI",
    "IMERG_VARIABLES",
    "REQUIRED_IMERG_VARIABLES",
    "SONORA_BOUNDS",
    "download_imerg_data",
    "extract_imerg_dataframe",
    "get_sonora_precipitation_dataframe",
    "join_nasadem_elevation",
    "sample_nasadem_elevation",
    "write_daily_csvs",
]

# write_daily_csvs(
#     get_sonora_precipitation_dataframe('/home/legion_user/Webpages/KLIMASERNTE/Backend/data/imerg'), 
#     '/home/legion_user/Webpages/KLIMASERNTE/Backend/data/sonora_precipitation')

df = pd.read_csv('/home/legion_user/Webpages/KLIMASERNTE/Backend/data/sonora_precipitation/sonora_imerg_2023-01-01.csv')

print(df)