"""
JevQL: PostgreSQL-compatible query language powered by TypeSafe Jev System One models.
"""

from .core import jevql, JevQLDatabase, JevClient, __version__

__all__ = ["jevql", "JevQLDatabase", "JevClient", "__version__"]
