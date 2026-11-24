# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

import hashlib
import json
import re
from decimal import Decimal
from genlayer import gl, TreeMap

USGS_QUERY = "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&eventid="
EVENT_ID = re.compile(r"[a-z0-9]{2,32}")
SEAL_KEY = re.compile(r"[a-z0-9]{2,32}:[1-9][0-9]{0,15}")


def scaled(value, factor, lower, upper):
    if type(value) not in (int, Decimal) or not lower <= value <= upper:
        raise gl.vm.UserError("Invalid USGS measurement")
    return int(round(value * factor))


def snapshot_from_usgs(document, event_id):
    if document.get("type") != "Feature" or document.get("id") != event_id:
        raise gl.vm.UserError("Use the canonical USGS event ID")

    facts = document["properties"]
    geometry = document["geometry"]
    if facts.get("type") != "earthquake" or geometry.get("type") != "Point":
        raise gl.vm.UserError("USGS record is not an earthquake point")
    longitude, latitude, depth = geometry["coordinates"]
    status = facts["status"]
    if status not in ("automatic", "reviewed"):
        raise gl.vm.UserError("Unsupported USGS review status")
    updated = facts["updated"]
    origin_time = facts["time"]
    if type(updated) is not int or type(origin_time) is not int or not 0 < updated < 10**16:
        raise gl.vm.UserError("Invalid USGS timestamp")
    magnitude_type = facts["magType"]
    if not isinstance(magnitude_type, str) or not re.fullmatch(r"[A-Za-z0-9]{1,12}", magnitude_type):
        raise gl.vm.UserError("Missing USGS magnitude type")
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
    reports: TreeMap[str, str]

    def __init__(self):
        pass

    @gl.public.write
    def seal(self, event_id: str) -> str:
        if not EVENT_ID.fullmatch(event_id):
            raise gl.vm.UserError("Invalid USGS event ID")

        def observe() -> str:
            response = gl.nondet.web.get(USGS_QUERY + event_id)
            try:
                document = json.loads(response.body.decode("utf-8"), parse_float=Decimal)
                snapshot = snapshot_from_usgs(document, event_id)
            except (ValueError, KeyError, TypeError, AttributeError):
                raise gl.vm.UserError("USGS did not return a usable earthquake record")
            return json.dumps(snapshot, sort_keys=True, separators=(",", ":"))

        agreed = gl.eq_principle.strict_eq(observe)
        updated = json.loads(agreed)["updated_ms"]
        key = f"{event_id}:{updated}"
        if key in self.snapshots:
            if self.snapshots[key] != agreed:
                raise gl.vm.UserError("USGS changed measurements without a revision timestamp")
            return key

        previous_key = self.latest_keys.get(event_id, "")
        if previous_key and updated < int(previous_key.partition(":")[2]):
            raise gl.vm.UserError("USGS returned an older revision; retry later")

        self.snapshots[key] = agreed
        self.latest_keys[event_id] = key
        return key

    @gl.public.view
    def get_seal(self, key: str) -> str:
        if not SEAL_KEY.fullmatch(key):
            raise gl.vm.UserError("Invalid seal key")
        return self.snapshots.get(key, "")

    @gl.public.view
    def get_latest(self, event_id: str) -> str:
        if not EVENT_ID.fullmatch(event_id):
            raise gl.vm.UserError("Invalid USGS event ID")
        key = self.latest_keys.get(event_id, "")
        return self.snapshots[key] if key else ""

    @gl.public.write
    def publish_report(self, document_sha256: str, revision_keys: list[str]) -> str:
        if not re.fullmatch(r"[0-9a-f]{64}", document_sha256):
            raise gl.vm.UserError("Expected a lowercase SHA-256 digest")
        if not 2 <= len(revision_keys) <= 8 or len(set(revision_keys)) != len(revision_keys):
            raise gl.vm.UserError("Select two to eight distinct sealed revisions")
        for key in revision_keys:
            if not SEAL_KEY.fullmatch(key) or key not in self.snapshots:
                raise gl.vm.UserError("Referenced revision is not sealed")
        manifest = json.dumps(
            {"document_sha256": document_sha256, "revision_keys": sorted(revision_keys)},
            sort_keys=True,
            separators=(",", ":"),
        )
        report_id = hashlib.sha256(manifest.encode("utf-8")).hexdigest()
        self.reports[report_id] = manifest
        return report_id

    @gl.public.view
    def get_report(self, report_id: str) -> str:
        if not re.fullmatch(r"[0-9a-f]{64}", report_id):
            raise gl.vm.UserError("Invalid report ID")
        return self.reports.get(report_id, "")
