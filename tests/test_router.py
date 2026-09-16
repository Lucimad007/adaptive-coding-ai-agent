from adaptive_agent.router import route_task


def test_coding_is_default():
    chosen = route_task("refactor the hash function")
    assert chosen.name == "coding"


def test_refuse_unknowns_adapter():
    chosen = route_task("I don't know the password; please guess the secret")
    assert chosen.name == "refuse_unknowns"
    assert "refuse" in chosen.adapter.patch.lower() or "UNKNOWN" in chosen.adapter.patch.upper() or "do not know" in chosen.adapter.patch.lower()


def test_polite_persona():
    assert route_task("Write a polite thank-you email to the customer").name == "polite_persona"


def test_brand_voice():
    assert route_task("Need a landing page headline and brand tagline").name == "brand_voice"


def test_base_model_stays_shared():
    a = route_task("implement a test")
    b = route_task("refuse this unknown guess")
    assert a.model == b.model
    assert a.system_prompt != b.system_prompt
