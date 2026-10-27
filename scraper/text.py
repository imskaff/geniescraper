"""Text normalisation shared by the title matchers of the external lookups."""

import re
import unicodedata

FEAT_SPLIT = re.compile(r"[(\[]\s*(?:feat|ft|featuring|with)\b|\b(?:feat|ft|featuring)\b\.?", re.IGNORECASE)


def words(text: str) -> list[str]:
    """Lowercase, accent-folded words: "BAD BUNNY x DÁKITI (Audio)" -> ["bad", "bunny", "x", "dakiti", "audio"]."""
    folded = "".join(c for c in unicodedata.normalize("NFKD", text.lower()) if not unicodedata.combining(c))
    return re.findall(r"[^\W_]+", folded)


def core_title_words(title: str) -> list[str]:
    """Words of a track title without its featured-artist part: "Fortnight (feat. Post Malone)" -> ["fortnight"]."""
    return words(FEAT_SPLIT.split(title, maxsplit=1)[0])
