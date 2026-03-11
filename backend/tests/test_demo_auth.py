from app.security import AuthContext, get_auth_context


def test_demo_mode_bypasses_missing_tokens(monkeypatch):
    monkeypatch.setenv("DEMO_DISABLE_AUTH", "true")
    monkeypatch.delenv("ACCESS_TOKEN_SECRET", raising=False)
    monkeypatch.delenv("REFRESH_TOKEN_SECRET", raising=False)

    ctx = get_auth_context(None)

    assert isinstance(ctx, AuthContext)
    assert ctx.user_id == "demo-user"
    assert "chat:write" in ctx.scopes
    assert "speech:write" in ctx.scopes
    assert "admin" in ctx.roles


def test_demo_mode_uses_configured_user(monkeypatch):
    monkeypatch.setenv("DEMO_DISABLE_AUTH", "1")
    monkeypatch.setenv("DEMO_AUTH_USER", "sales-demo")

    ctx = get_auth_context(None)

    assert ctx.user_id == "sales-demo"
