import pytest

from utils import config


def _settings(env_file: str | None) -> config.Settings:
    """Load Settings from `env_file` (None: defaults only, never the real .env).

    `_env_file` is a pydantic-settings init kwarg that its dataclass_transform signature does not declare.
    """
    return config.Settings(_env_file=env_file)  # pyright: ignore[reportCallIssue]


def test_save_round_trips_every_field(tmp_path, monkeypatch):
    env = tmp_path / ".env"
    monkeypatch.setattr(config, "_ENV_PATH", env)
    original = _settings(None)
    changed = original.model_copy(
        update={
            "hotkey": "f9",
            "back_hotkey": "f6",
            "typing_delay": 0.1,
            "autocomplete_wait": 0.9,
            "scrape_youtube": False,
            "auto_tab": True,
            "auto_start_delay": 7,
            "bridge_secret": "ab" * 32,
            "bridge_origin": "chrome-extension://" + "a" * 32,
            "link_mode": "manual",
            "win_x": 10,
            "win_y": 20,
        }
    )
    changed.save()
    reloaded = _settings(str(env))
    assert reloaded.model_dump() == changed.model_dump()


def test_save_covers_all_fields(tmp_path, monkeypatch):
    """A new Settings field must also be written by save(), or it silently resets."""
    env = tmp_path / ".env"
    monkeypatch.setattr(config, "_ENV_PATH", env)
    _settings(None).save()
    written = {line.split("=", 1)[0].lower() for line in env.read_text(encoding="utf-8").splitlines() if "=" in line}
    assert written == set(config.Settings.model_fields)


def test_settings_path_is_per_user():
    assert config.settings_path("C:/Users/x/AppData/Roaming") == config.Path(
        "C:/Users/x/AppData/Roaming/Geniescraper/settings.env"
    )


def test_save_creates_the_settings_folder(tmp_path, monkeypatch):
    env = tmp_path / "Geniescraper" / "settings.env"
    monkeypatch.setattr(config, "_ENV_PATH", env)
    _settings(None).save()
    assert env.is_file()


def test_per_user_file_wins_over_legacy_checkout_env(tmp_path):
    legacy, user = tmp_path / "legacy.env", tmp_path / "user.env"
    legacy.write_text("AUTO_TAB=true\nHOTKEY=f9\n", encoding="utf-8")
    user.write_text("HOTKEY=f10\n", encoding="utf-8")
    loaded = config.Settings(_env_file=(str(legacy), str(user)))  # pyright: ignore[reportCallIssue]
    assert (loaded.auto_tab, loaded.hotkey) == (True, "f10")


def test_parallel_reads_defaults_to_one_track_at_a_time():
    assert _settings(None).parallel_reads == 1


def test_parallel_reads_is_saved_and_loaded(tmp_path, monkeypatch):
    env = tmp_path / ".env"
    monkeypatch.setattr(config, "_ENV_PATH", env)
    _settings(None).model_copy(update={"parallel_reads": 3}).save()
    assert _settings(str(env)).parallel_reads == 3


@pytest.mark.parametrize("written", ["4", "-1", "many"])
def test_parallel_reads_outside_the_choices_falls_back_to_the_default(tmp_path, written):
    env = tmp_path / ".env"
    env.write_text(f"PARALLEL_READS={written}\n", encoding="utf-8")
    assert _settings(str(env)).parallel_reads == 1


def test_parallel_reads_zero_means_all_at_once(tmp_path):
    env = tmp_path / ".env"
    env.write_text("PARALLEL_READS=0\n", encoding="utf-8")
    assert _settings(str(env)).parallel_reads == 0


def test_pairing_secret_stays_out_of_repr():
    secret = "cd" * 32
    loaded = _settings(None).model_copy(update={"bridge_secret": secret})
    assert secret not in repr(loaded)
    assert secret not in str(loaded)


def test_link_mode_only_accepts_the_two_modes():
    assert config.Settings(link_mode="AUTO").link_mode == "auto"  # pyright: ignore[reportCallIssue]
    assert config.Settings(link_mode="Manual").link_mode == "manual"  # pyright: ignore[reportCallIssue]
    assert config.Settings(link_mode="whatever").link_mode == "auto"  # pyright: ignore[reportCallIssue]


def test_link_mode_defaults_to_auto_and_a_saved_manual_is_kept():
    assert _settings(None).link_mode == "auto"
    assert config.Settings(link_mode="manual").link_mode == "manual"  # pyright: ignore[reportCallIssue]
