from app.error_sanitizer import sanitize_error


def test_sanitize_error_redacts_postgres_urls():
    result = sanitize_error(
        "failed postgresql://user:secret@localhost:5432/dbname while connecting"
    )

    assert "postgresql://user:secret" not in result
    assert "[REDACTED_DATABASE_URL]" in result


def test_sanitize_error_redacts_authorization_headers():
    result = sanitize_error("Authorization: Bearer abc123secret")

    assert "abc123secret" not in result
    assert "[REDACTED_AUTHORIZATION]" in result


def test_sanitize_error_redacts_secret_assignments():
    result = sanitize_error(
        "api_key=abc token=def password=hunter2 secret=sauce CHAINABUSE_API_KEY=xyz"
    )

    assert "abc" not in result
    assert "def" not in result
    assert "hunter2" not in result
    assert "sauce" not in result
    assert "xyz" not in result
    assert result.count("[REDACTED_SECRET]") == 5


def test_sanitize_error_truncates_long_xml_body():
    result = sanitize_error("<root>" + ("x" * 2000) + "</root>", max_length=80)

    assert result == "Large response body omitted."
    assert len(result) <= 80


def test_sanitize_error_truncates_long_json_body():
    result = sanitize_error('{"payload":"' + ("x" * 2000) + '"}', max_length=80)

    assert result == "Large response body omitted."
    assert len(result) <= 80


def test_sanitize_error_returns_non_empty_string():
    assert sanitize_error("") == "Unknown error."
    assert sanitize_error(RuntimeError()) == "RuntimeError"
