"""Tests for the linked git worktree guard in thoth_core.resolve_root."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

from thoth_core import linked_worktree_main_root

PROJECT_ROOT = Path(__file__).resolve().parent.parent


def _git(cwd: Path, *args: str) -> None:
    res = subprocess.run(
        ["git", *args],
        cwd=str(cwd),
        text=True,
        capture_output=True,
        check=False,
    )
    assert res.returncode == 0, f"git {' '.join(args)} failed: {res.stderr}"


def _run_cli(
    module: str,
    args: list[str],
    *,
    cwd: Path,
    env_extra: dict[str, str] | None = None,
) -> tuple[int, str, str]:
    env = os.environ.copy()
    env.pop("THOTH_ALLOW_WORKTREE", None)
    if env_extra:
        env.update(env_extra)
    res = subprocess.run(
        [sys.executable, "-m", module, *args],
        cwd=str(cwd),
        env=env,
        text=True,
        capture_output=True,
    )
    return res.returncode, res.stdout, res.stderr


def _init_repo_with_worktree(tmp_path: Path) -> tuple[Path, Path]:
    main_repo = tmp_path / "main-instance"
    main_repo.mkdir()
    _git(main_repo, "init")
    _git(main_repo, "config", "user.name", "Test User")
    _git(main_repo, "config", "user.email", "test@example.com")
    (main_repo / "README.md").write_text("instance\n", encoding="utf-8")
    _git(main_repo, "add", "README.md")
    _git(main_repo, "commit", "-m", "initial")

    wt = tmp_path / "linked-wt"
    _git(main_repo, "worktree", "add", "-b", "wt-branch", str(wt))
    return main_repo.resolve(), wt.resolve()


def test_linked_worktree_detection_distinguishes_main_worktree_and_submodule(tmp_path: Path) -> None:
    main_repo, wt = _init_repo_with_worktree(tmp_path)

    # Regular repo and non-git dir -> None
    assert linked_worktree_main_root(main_repo) is None
    non_git = tmp_path / "plain"
    non_git.mkdir()
    assert linked_worktree_main_root(non_git) is None

    # Linked worktree root and nested subdir -> main_repo
    assert linked_worktree_main_root(wt) == main_repo
    nested = wt / "nested" / "sub"
    nested.mkdir(parents=True)
    assert linked_worktree_main_root(nested) == main_repo

    # Simulated git submodule (.git file pointing to modules dir with NO commondir) -> None
    sub_gitdir = main_repo / ".git" / "modules" / "sub"
    sub_gitdir.mkdir(parents=True)
    (sub_gitdir / "HEAD").write_text("ref: refs/heads/master\n", encoding="utf-8")
    sub_dir = main_repo / "sub"
    sub_dir.mkdir()
    (sub_dir / ".git").write_text("gitdir: ../.git/modules/sub\n", encoding="utf-8")
    assert linked_worktree_main_root(sub_dir) is None


def test_state_clis_refuse_linked_worktree_and_honor_overrides(tmp_path: Path) -> None:
    main_repo, wt = _init_repo_with_worktree(tmp_path)

    state_clis = [
        ("health_track.cli", ["list"]),
        ("thoth_mem.cli", ["list"]),
        ("todo_list.cli", ["list"]),
        ("auto_commit.cli", ["validate"]),
    ]

    for module, cmd_args in state_clis:
        # Works in main checkout
        code, out, err = _run_cli(module, cmd_args, cwd=main_repo)
        assert code == 0, f"{module} failed in main repo: {err}"
        assert json.loads(out)["ok"] is True

        # Refuses in linked worktree with clear JSON error naming main_repo
        code, out, err = _run_cli(module, cmd_args, cwd=wt)
        assert code != 0, f"{module} unexpectedly succeeded in linked worktree"
        payload = json.loads(err)
        assert payload["ok"] is False
        assert "linked git worktree" in payload["error"]
        assert str(main_repo) in payload["error"]

        # Works with --allow-worktree flag
        code, out, err = _run_cli(module, ["--allow-worktree", *cmd_args], cwd=wt)
        assert code == 0, f"{module} --allow-worktree failed: {err}"
        assert json.loads(out)["ok"] is True

        # Works with THOTH_ALLOW_WORKTREE=1 env var
        code, out, err = _run_cli(module, cmd_args, cwd=wt, env_extra={"THOTH_ALLOW_WORKTREE": "1"})
        assert code == 0, f"{module} THOTH_ALLOW_WORKTREE=1 failed: {err}"
        assert json.loads(out)["ok"] is True


def test_non_state_helper_clis_still_work_in_linked_worktree(tmp_path: Path) -> None:
    main_repo, wt = _init_repo_with_worktree(tmp_path)
    (wt / "thoth.toml").write_text('[threads]\ntitle_prefix = "Test | "\n', encoding="utf-8")

    code, out, err = _run_cli("thread_plan.cli", ["validate"], cwd=wt)
    assert code == 0, f"thread-plan failed in linked worktree: {err}"
    assert json.loads(out)["ok"] is True

    (wt / "harnesses.toml").write_text(
        'providers = ["codex"]\n[aliases]\nsol = { provider = "codex", model = "gpt-6.2-sol" }\n'
        '[routes.gmail]\nprimary = "sol"\n',
        encoding="utf-8",
    )
    code, out, err = _run_cli("harness_route.cli", ["validate"], cwd=wt)
    assert code == 0, f"harness-route failed in linked worktree: {err}"
    assert json.loads(out)["ok"] is True
