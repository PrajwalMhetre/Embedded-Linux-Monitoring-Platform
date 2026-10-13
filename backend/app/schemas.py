"""Validated telemetry API schema shared by ingestion and retrieval."""

import math
from datetime import UTC, datetime
from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator
from pydantic_core import PydanticCustomError


class OSInfo(BaseModel):
    model_config = ConfigDict(extra="forbid")

    system: str = Field(min_length=1, max_length=100)
    release: str = Field(min_length=1, max_length=200)
    version: str = Field(min_length=1, max_length=300)
    machine: str = Field(min_length=1, max_length=100)


class TelemetryPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["1.0"]
    timestamp: AwareDatetime
    hostname: str = Field(min_length=1, max_length=253)
    os: OSInfo
    cpu_percent: float | None = Field(default=None, ge=0, le=100)
    memory_percent: float | None = Field(default=None, ge=0, le=100)
    disk_root_percent: float | None = Field(default=None, ge=0, le=100)
    load_average: list[float] | None = Field(default=None, min_length=3, max_length=3)
    uptime_seconds: float | None = Field(default=None, ge=0)
    process_count: int | None = Field(default=None, ge=0)
    cpu_temperature_c: float | None = Field(default=None, ge=-50, le=200)

    @field_validator("timestamp")
    @classmethod
    def normalize_timestamp(cls, value: datetime) -> datetime:
        return value.astimezone(UTC)

    @field_validator("cpu_percent", "memory_percent", "disk_root_percent", "uptime_seconds", "cpu_temperature_c", mode="before")
    @classmethod
    def reject_boolean_metrics(cls, value: object) -> object:
        if isinstance(value, bool):
            raise PydanticCustomError("invalid_metric_type", "boolean values are not valid metrics")
        return value

    @field_validator("process_count", mode="before")
    @classmethod
    def reject_boolean_process_count(cls, value: object) -> object:
        if isinstance(value, bool):
            raise PydanticCustomError("invalid_metric_type", "process_count must be an integer")
        return value

    @field_validator("load_average", mode="before")
    @classmethod
    def reject_boolean_load_values(cls, value: object) -> object:
        if isinstance(value, list) and any(isinstance(number, bool) for number in value):
            raise ValueError("load average values must be numeric")
        return value

    @field_validator("cpu_percent", "memory_percent", "disk_root_percent", "uptime_seconds", "cpu_temperature_c")
    @classmethod
    def finite_metrics(cls, value: float | None) -> float | None:
        if value is not None and not math.isfinite(value):
            raise ValueError("metric must be finite")
        return value

    @field_validator("load_average")
    @classmethod
    def finite_load_average(cls, value: list[float] | None) -> list[float] | None:
        if value is not None and any(number < 0 or not math.isfinite(number) for number in value):
            raise ValueError("load average values must be finite and non-negative")
        return value


class HealthResponse(BaseModel):
    status: Literal["ok"]
    database: Literal["ok"]
