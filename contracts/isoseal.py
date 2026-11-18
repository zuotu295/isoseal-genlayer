# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

import json
import re
from decimal import Decimal
from genlayer import gl, TreeMap

USGS_QUERY = "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&eventid="
EVENT_ID = re.compile(r"[a-z0-9]{2,32}")
SEAL_KEY = re.compile(r"[a-z0-9]{2,32}:[1-9][0-9]{0,15}")


def scaled(value, factor, lower, upper):
    if type(value) not in (int, Decimal) or not lower <= value <= upper:
        raise gl.UserError("Invalid USGS measurement")
    return int(round(value * factor))


def snapshot_from_usgs(document, event_id):
    if document.get("type") != "Feature" or document.get("id") != event_id:
        raise gl.UserError("Use the canonical USGS event ID")

    facts = document["properties"]
    geometry = document["geometry"]
    if facts.get("type") != "earthquake" or geometry.get("type") != "Point":
        raise gl.UserError("USGS record is not an earthquake point")
    longitude, latitude, depth = geometry["coordinates"]
    status = facts["status"]
    if status not in ("automatic", "reviewed"):
        raise gl.UserError("Unsupported USGS review status")
    updated = facts["updated"]
    origin_time = facts["time"]
    if type(updated) is not int or type(origin_time) is not int or not 0 < updated < 10**16:
        raise gl.UserError("Invalid USGS timestamp")
    magnitude_type = facts["magType"]
    if not isinstance(magnitude_type, str) or not re.fullmatch(r"[A-Za-z0-9]{1,12}", magnitude_type):
        raise gl.UserError("Missing USGS magnitude type")
    return {
        "id": event_id,
        "updated_ms": updated,
        "origin_ms": origin_time,
        "magnitude_milli": scaled(facts["mag"], 1000, -15, 15),
        "magnitude_type": magnitude_type,
        "status": status,
        "latitude_microdegrees": scaled(latitude, 1000000, -90, 90),
        "longitude_microdegrees": scaled(longitude, 1000000, -180, 180),
        "depth_m": scaled(depth, 1000, -20, 1000),
    }


class IsoSeal(gl.Contract):
    snapshots: TreeMap[str, str]
    latest_keys: TreeMap[str, str]

    def __init__(self):
        pass

    @gl.public.write
    def seal(self, event_id: str) -> str:
        if not EVENT_ID.fullmatch(event_id):
            raise gl.UserError("Invalid USGS event ID")

        def observe() -> str:
            response = gl.nondet.web.get(USGS_QUERY + event_id)
            try:
                document = json.loads(response.body.decode("utf-8"), parse_float=Decimal)
                snapshot = snapshot_from_usgs(document, event_id)
            except (ValueError, KeyError, TypeError, AttributeError):
                raise gl.UserError("USGS did not return a usable earthquake record")
            return json.dumps(snapshot, sort_keys=True, separators=(",", ":"))

        agreed = gl.eq_principle.strict_eq(observe)
        updated = json.loads(agreed)["updated_ms"]
        key = f"{event_id}:{updated}"
        if key in self.snapshots:
            if self.snapshots[key] != agreed:
                raise gl.UserError("USGS changed measurements without a revision timestamp")
            return key

        previous_key = self.latest_keys.get(event_id, "")
        if previous_key and updated < int(previous_key.partition(":")[2]):
            raise gl.UserError("USGS returned an older revision; retry later")

        self.snapshots[key] = agreed
        self.latest_keys[event_id] = key
        return key

    @gl.public.view
    def get_seal(self, key: str) -> str:
        if not SEAL_KEY.fullmatch(key):
            raise gl.UserError("Invalid seal key")
        return self.snapshots.get(key, "")

    @gl.public.view
    def get_latest(self, event_id: str) -> str:
        if not EVENT_ID.fullmatch(event_id):
            raise gl.UserError("Invalid USGS event ID")
        key = self.latest_keys.get(event_id, "")
        return self.snapshots[key] if key else ""
