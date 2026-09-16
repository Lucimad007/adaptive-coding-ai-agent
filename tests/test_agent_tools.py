from adaptive_agent.agent import reset_demo_env, run_tests


def test_run_tests_fails_until_install():
    reset_demo_env()
    assert "ERROR" in run_tests.invoke({"install_deps": False})
    assert "OK:" in run_tests.invoke({"install_deps": True})
    reset_demo_env()
    assert "ERROR" in run_tests.invoke({"install_deps": False})
