from utils import config


def test_save_round_trips_every_field(tmp_path, monkeypatch):
    env = tmp_path / ".env"
    monkeypatch.setattr(config, "_ENV_PATH", env)
    original = config.Settings(_env_file=None)
    changed = original.model_copy(
        update={
            "hotkey": "f9",
            "back_hotkey": "f6",
            "typing_delay": 0.1,
            "autocomplete_wait": 0.9,
            "scrape_youtube": False,
            "auto_tab": True,
            "auto_start_delay": 7,
            "win_x": 10,
            "win_y": 20,
        }
    )
    changed.save()
    reloaded = config.Settings(_env_file=str(env))
    assert reloaded.model_dump() == changed.model_dump()


def test_save_covers_all_fields(tmp_path, monkeypatch):
    """A new Settings field must also be written by save(), or it silently resets."""
    env = tmp_path / ".env"
    monkeypatch.setattr(config, "_ENV_PATH", env)
    config.Settings(_env_file=None).save()
    written = {line.split("=", 1)[0].lower() for line in env.read_text(encoding="utf-8").splitlines() if "=" in line}
    assert written == set(config.Settings.model_fields)
