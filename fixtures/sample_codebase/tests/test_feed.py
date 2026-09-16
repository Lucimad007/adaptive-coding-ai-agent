from app import get_feed


def test_feed():
    assert get_feed() is not None
