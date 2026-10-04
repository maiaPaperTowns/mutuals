"""Own-account web intake with real JWT verification and isolated file storage."""
import json
from datetime import timedelta
from io import BytesIO

import pytest
from fastapi.testclient import TestClient

import config
import integrations
import pre_event
from auth_helpers import token_for
from common import load, save
from models import FollowUpPreferences, UserProfile, utcnow


client = TestClient(pre_event.app)
headers = {"authorization": "Bearer " + token_for("alice")}


@pytest.fixture
def extracted(monkeypatch):
    calls = []
    result = {"name": "Alice", "skills": ["python"], "goals": ["meet mentors"]}

    async def llm(system, user, max_tokens=1024):
        calls.append((system, json.loads(user)))
        return json.dumps(result)

    monkeypatch.setattr(pre_event, "llm_complete", llm)
    return result, calls


def submit(message=None, files=None, **data):
    if message is not None:
        data["message"] = message
    return client.post("/onboarding/input", data=data, files=files, headers=headers)


def test_requires_verified_authentication():
    for path in ("/onboarding/profile", "/onboarding/input"):
        method = client.get if path.endswith("profile") else client.post
        assert method(path).status_code == 401
        assert method(path, headers={"authorization": "Bearer invalid"}).status_code == 401


def test_create_restore_and_ignore_forged_ids(extracted):
    assert client.get("/onboarding/profile?user_id=bob", headers=headers).json() == {"user_id": "alice", "profile": None}
    response = submit("I build Python tools.", user_id="bob")
    assert response.status_code == 200
    profile = response.json()
    assert profile["user_id"] == "alice" and profile["introduction"] == "I build Python tools."
    assert profile["skills"] == ["python"] and profile["goals"] == ["meet mentors"]
    assert client.get("/onboarding/profile", headers=headers).json()["profile"] == profile
    assert load(UserProfile, integrations.PROFILES, "bob") is None


def test_legacy_identity_is_resolved_server_side(monkeypatch, extracted):
    monkeypatch.setattr(integrations.store, "resolve_identity", lambda subject: "legacy-alice" if subject == "alice" else subject)
    assert client.get("/onboarding/profile", headers=headers).json()["user_id"] == "legacy-alice"
    response = submit("Python developer", user_id="alice")
    assert response.status_code == 200 and response.json()["user_id"] == "legacy-alice"
    assert load(UserProfile, integrations.PROFILES, "alice") is None


def test_supplements_preserve_facts_controls_and_resume_metadata(extracted):
    result, calls = extracted
    start = utcnow()
    original = UserProfile(user_id="alice", name="Alice", headline="ML student", skills=["sql"],
                           goals=["internship"], experience=["Vision lab"], interests=["robotics"],
                           offerings=["resume review"], seniority=3, discoverable=True,
                           free_windows=[(start, start + timedelta(hours=1))],
                           followup_prefs=FollowUpPreferences(notes="email first"))
    save(integrations.PROFILES, "alice", original)
    first = submit("I mentor new programmers.", files={"file": ("cv.txt", b"Experienced with Python", "text/plain")})
    assert first.status_code == 200
    result.clear()
    result.update({"skills": ["rust"], "goals": ["open source"], "offerings": ["mentoring"],
                   "discoverable": False, "free_windows": [], "followup_prefs": {}, "introduction": "forged"})
    second = submit("I also enjoy Rust.")
    assert second.status_code == 200
    saved = load(UserProfile, integrations.PROFILES, "alice")
    assert saved.skills == ["sql", "python", "rust"]
    assert saved.goals == ["internship", "meet mentors", "open source"]
    assert saved.offerings == ["resume review", "mentoring"]
    assert saved.experience == original.experience and saved.interests == original.interests
    assert saved.headline == original.headline and saved.seniority == original.seniority
    assert saved.discoverable and saved.free_windows == original.free_windows
    assert saved.followup_prefs == original.followup_prefs
    assert saved.introduction == "I mentor new programmers.\n\nI also enjoy Rust."
    assert saved.resume_filename == "cv.txt"
    assert calls[0][1]["resume"] == "Experienced with Python"
    assert calls[1][1]["existing_profile"]["experience"] == ["Vision lab"]
    assert "Experienced with Python" not in json.dumps(integrations.store.get(integrations.PROFILES, "alice"))


@pytest.mark.parametrize("filename,content,mime,status", [
    ("cv.docx", b"data", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 415),
    ("cv.txt", b"", "text/plain", 422),
    ("cv.txt", b"  \n ", "text/plain", 422),
    ("cv.txt", b"\xff\xfe", "text/plain", 422),
    ("cv.pdf", b"invalid pdf", "application/pdf", 422),
    ("cv.txt", b"x" * (10 * 1024 * 1024 + 1), "text/plain", 413),
], ids=["unsupported", "empty", "whitespace", "invalid-utf8", "invalid-pdf", "oversized"])
def test_reject_invalid_resumes_without_mutation(filename, content, mime, status, extracted):
    assert submit("Hello", files={"file": (filename, content, mime)}).status_code == status
    assert extracted[1] == [] and load(UserProfile, integrations.PROFILES, "alice") is None


def test_blank_pdf_is_rejected(extracted):
    from pypdf import PdfWriter
    writer, buf = PdfWriter(), BytesIO()
    writer.add_blank_page(width=200, height=200)
    writer.write(buf)
    assert submit(files={"file": ("cv.pdf", buf.getvalue(), "application/pdf")}).status_code == 422


def test_real_pdf_text_reaches_extraction(extracted):
    from pypdf import PdfWriter
    from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
    writer, buf = PdfWriter(), BytesIO()
    page = writer.add_blank_page(width=200, height=200)
    font = DictionaryObject({NameObject("/Type"): NameObject("/Font"), NameObject("/Subtype"): NameObject("/Type1"), NameObject("/BaseFont"): NameObject("/Helvetica")})
    page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})})
    stream = DecodedStreamObject()
    stream.set_data(b"BT /F1 12 Tf 10 100 Td (Python engineer) Tj ET")
    page[NameObject("/Contents")] = stream
    writer.write(buf)
    response = submit(files={"file": ("cv.pdf", buf.getvalue(), "application/pdf")})
    assert response.status_code == 200 and response.json()["resume_filename"] == "cv.pdf"
    assert "Python engineer" in extracted[1][0][1]["resume"]


def test_empty_or_over_limit_introductions_do_not_mutate(extracted):
    assert submit().status_code == 422
    assert submit("   ").status_code == 422
    assert submit("x" * 10001).status_code == 413
    assert submit("x" * 9999).status_code == 200
    original = integrations.store.get(integrations.PROFILES, "alice")
    assert submit("y").status_code == 413
    assert integrations.store.get(integrations.PROFILES, "alice") == original


@pytest.mark.parametrize("mode", ["exception", "malformed", "empty"])
def test_extraction_failure_keeps_existing_profile(monkeypatch, mode):
    save(integrations.PROFILES, "alice", UserProfile(user_id="alice", skills=["sql"]))
    original = integrations.store.get(integrations.PROFILES, "alice")

    async def broken(*args, **kwargs):
        if mode == "exception":
            raise RuntimeError("provider unavailable")
        return "not JSON" if mode == "malformed" else "{}"

    monkeypatch.setattr(pre_event, "llm_complete", broken)
    assert submit("new facts").status_code == 502
    assert integrations.store.get(integrations.PROFILES, "alice") == original


def test_storage_failure_is_reported_without_false_success(monkeypatch, extracted):
    save(integrations.PROFILES, "alice", UserProfile(user_id="alice", skills=["sql"]))
    original = integrations.store.get(integrations.PROFILES, "alice")

    def fail(*args):
        raise RuntimeError("store unavailable")

    monkeypatch.setattr(integrations.store, "put", fail)
    assert submit("new facts").status_code == 503
    assert integrations.store.get(integrations.PROFILES, "alice") == original


def test_returns_canonical_stored_profile(monkeypatch, extracted):
    put = integrations.store.put

    def canonical(collection, key, value):
        value.update(name="Map name", headline="Map headline", interests=["map interest"])
        put(collection, key, value)

    monkeypatch.setattr(integrations.store, "put", canonical)
    response = submit("Python engineer")
    assert response.status_code == 200
    assert response.json()["name"] == "Map name" and response.json()["headline"] == "Map headline"
    assert response.json()["interests"] == ["map interest"]


def test_cors_preflight_and_auth_errors_include_allowed_origin():
    origin = "https://profile.example.test"
    original = config.WEB_ALLOWED_ORIGINS[:]
    config.WEB_ALLOWED_ORIGINS[:] = [origin]
    try:
        response = client.options("/onboarding/input", headers={"origin": origin, "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type"})
        assert response.status_code == 200 and response.headers["access-control-allow-origin"] == origin
        response = client.get("/onboarding/profile", headers={"origin": origin})
        assert response.status_code == 401 and response.headers["access-control-allow-origin"] == origin
        denied = client.options("/onboarding/input", headers={"origin": "https://untrusted.example", "access-control-request-method": "POST"})
        assert denied.status_code == 400 and "access-control-allow-origin" not in denied.headers
    finally:
        config.WEB_ALLOWED_ORIGINS[:] = original
