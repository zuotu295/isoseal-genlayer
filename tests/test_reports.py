"""Exercise deterministic report storage with an in-memory GenLayer API stub."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch


class UserError(Exception):
    pass


sdk = ModuleType("genlayer")
sdk.TreeMap = dict
sdk.gl = SimpleNamespace(
    Contract=object,
    vm=SimpleNamespace(UserError=UserError),
    public=SimpleNamespace(write=lambda method: method, view=lambda method: method),
)
spec = importlib.util.spec_from_file_location(
    "isoseal_contract", Path(__file__).resolve().parents[1] / "contracts/isoseal.py"
)
contract = importlib.util.module_from_spec(spec)
with patch.dict(sys.modules, {"genlayer": sdk}):
    spec.loader.exec_module(contract)


class ReportTests(unittest.TestCase):
    def setUp(self):
        self.iso = contract.IsoSeal()
        self.keys = ["us123:42", "us456:52"]
        self.digest = hashlib.sha256(b"Example report\n").hexdigest()
        self.iso.snapshots = dict.fromkeys(self.keys, '{"status":"reviewed"}')
        self.iso.latest_keys = {"us123": self.keys[0], "us456": self.keys[1]}
        self.iso.reports = {}

    def test_publish_is_canonical_and_idempotent(self):
        report_id = self.iso.publish_report(self.digest, self.keys[::-1])
        raw = self.iso.get_report(report_id)
        self.assertEqual(hashlib.sha256(raw.encode()).hexdigest(), report_id)
        self.assertEqual(json.loads(raw), {
            "document_sha256": self.digest, "revision_keys": self.keys,
        })
        self.assertEqual(self.iso.publish_report(self.digest, self.keys), report_id)
        self.assertEqual(len(self.iso.reports), 1)

    def test_invalid_inputs_cannot_store_a_record(self):
        for digest, keys in [
            ("BAD", self.keys), (self.digest, self.keys[:1]),
            (self.digest, [self.keys[0], self.keys[0]]),
            (self.digest, [self.keys[0], "us456:999"]),
            (self.digest, [self.keys[0], "malformed"]),
            (self.digest, [f"us{i}:42" for i in range(9)]),
        ]:
            with self.subTest(digest=digest, keys=keys), self.assertRaises(UserError):
                self.iso.publish_report(digest, keys)
        self.assertEqual(self.iso.reports, {})

    def test_pinned_revision_survives_latest_pointer_change(self):
        report_id = self.iso.publish_report(self.digest, self.keys)
        self.iso.snapshots["us123:43"] = '{"status":"automatic"}'
        self.iso.latest_keys["us123"] = "us123:43"
        raw = self.iso.get_report(report_id)
        self.assertIn(self.keys[0], json.loads(raw)["revision_keys"])
        self.assertNotEqual(self.iso.get_seal(self.keys[0]), self.iso.get_latest("us123"))
        self.assertEqual(self.iso.get_report("0" * 64), "")
        with self.assertRaises(UserError):
            self.iso.get_report("invalid")
