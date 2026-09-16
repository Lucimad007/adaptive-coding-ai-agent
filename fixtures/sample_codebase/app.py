"""Tiny standalone sample app used as a graph-extraction target."""

from feed.ranker import rank_clip
from feed.player import autoplay
from feed.prefs import user_prefs


def get_feed():
    """Return the ranked clip feed, autoplaying the top clip if the user opted in."""
    clips = fetch_clip()
    ranked = rank_clip(clips)
    if user_prefs().get("autoplay"):
        return autoplay(ranked)
    return ranked


def fetch_clip():
    return ["clip-1", "clip-2"]
