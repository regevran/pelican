"""Publish one static WorldState message to RabbitMQ."""

from __future__ import annotations

import json
import os
from pathlib import Path

import pika
from jsonschema import Draft202012Validator, RefResolver


EXCHANGE_NAME = "pelican.world_state"
REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
MESSAGES_DIRECTORY = REPOSITORY_ROOT / "messages"


def static_world_state() -> dict[str, object]:
    """Return the fixed world used by the first renderer slice."""
    return {
        "pools": [
            {
                "name": "pool_alpha",
                "boundary": [
                    {"longitude_degrees": 34.772435, "latitude_degrees": 32.08075, "height_meters": 0.0},
                    {"longitude_degrees": 34.771971, "latitude_degrees": 32.081111, "height_meters": 0.0},
                    {"longitude_degrees": 34.771511, "latitude_degrees": 32.081245, "height_meters": 0.0},
                    {"longitude_degrees": 34.771246, "latitude_degrees": 32.081584, "height_meters": 0.0},
                    {"longitude_degrees": 34.770742, "latitude_degrees": 32.081622, "height_meters": 0.0},
                    {"longitude_degrees": 34.770257, "latitude_degrees": 32.08147, "height_meters": 0.0},
                    {"longitude_degrees": 34.769992, "latitude_degrees": 32.081125, "height_meters": 0.0},
                    {"longitude_degrees": 34.770125, "latitude_degrees": 32.08075, "height_meters": 0.0},
                    {"longitude_degrees": 34.769927, "latitude_degrees": 32.080351, "height_meters": 0.0},
                    {"longitude_degrees": 34.770155, "latitude_degrees": 32.079931, "height_meters": 0.0},
                    {"longitude_degrees": 34.770779, "latitude_degrees": 32.080001, "height_meters": 0.0},
                    {"longitude_degrees": 34.77121, "latitude_degrees": 32.080039, "height_meters": 0.0},
                    {"longitude_degrees": 34.771613, "latitude_degrees": 32.080156, "height_meters": 0.0},
                    {"longitude_degrees": 34.772036, "latitude_degrees": 32.080364, "height_meters": 0.0},
                ],
            }
        ],
        "flocks": [
            {
                "name": "flock_alpha",
                "position": {
                    "longitude_degrees": 34.7710,
                    "latitude_degrees": 32.0822,
                    "height_meters": 50.0,
                },
                "velocity": {
                    "x_meters_per_second": 1.0,
                    "y_meters_per_second": -2.0,
                    "z_meters_per_second": -3.2,
                },
            }
        ],
    }


def validate_world_state(world_state: dict[str, object]) -> None:
    """Validate a WorldState instance against its language-independent contract."""
    schema_path = MESSAGES_DIRECTORY / "world_state.schema.json"
    schema = json.loads(schema_path.read_text())
    resolver = RefResolver(base_uri=f"{MESSAGES_DIRECTORY.resolve().as_uri()}/", referrer=schema)
    validator = Draft202012Validator(schema, resolver=resolver)
    validator.validate(world_state)


def publish_world_state(world_state: dict[str, object]) -> None:
    """Publish WorldState through the shared fanout exchange."""
    connection_url = os.environ.get("RABBITMQ_URL", "amqp://guest:guest@localhost:5672/%2F")
    parameters = pika.URLParameters(connection_url)

    with pika.BlockingConnection(parameters) as connection:
        channel = connection.channel()
        channel.exchange_declare(exchange=EXCHANGE_NAME, exchange_type="fanout", durable=True)
        channel.basic_publish(
            exchange=EXCHANGE_NAME,
            routing_key="",
            body=json.dumps(world_state).encode("utf-8"),
            properties=pika.BasicProperties(
                content_type="application/json",
                delivery_mode=pika.DeliveryMode.Persistent,
                type="WorldState",
            ),
        )


def main() -> None:
    world_state = static_world_state()
    validate_world_state(world_state)
    publish_world_state(world_state)
    print("Published static WorldState.")


if __name__ == "__main__":
    main()
