"""Tiny standalone sample app used as a graph-extraction target."""

from feed.ranker import rank_clip
from feed.player import autoplay


def get_feed():
    clips = fetch_clip()
    ranked = rank_clip(clips)
    return autoplay(ranked)


def fetch_clip():
    return ["clip-1", "clip-2"]
