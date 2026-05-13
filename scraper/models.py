import re

from pydantic import BaseModel


def _copyright_paste_value(text: str) -> str:
    """Strip leading ℗/© symbol and year so only the label name is pasted."""
    return re.sub(r"^[℗©]\s*\d{4}\s*", "", text).strip()

# Roles that map to Genius's dedicated "Written By" field (above "Add additional credits").
_WRITTEN_BY_ROLES = frozenset({"songwriter", "lyricist", "co-writer", "writer"})
# Roles that map to Genius's dedicated "Produced By" field.
_PRODUCED_BY_ROLES = frozenset({"producer", "co-producer"})


class Credit(BaseModel):
    role: str
    artists: list[str]


class SongCredits(BaseModel):
    title: str
    artist: str
    apple_music_url: str
    credits: list[Credit]
    phonographic_copyright: str = ""
    copyright_notice: str = ""
    cover_art_url: str = ""
    youtube_url: str = ""
    youtube_is_mv: bool = False

    def merged_credits(self) -> list[Credit]:
        """
        Merge credits that share the same role into one entry.
        Preserves original order (first occurrence of each role wins position).
        Artists within a merged role are deduplicated while keeping order.
        """
        seen: dict[str, list[str]] = {}
        order: list[str] = []

        for credit in self.credits:
            key = credit.role.lower().strip()
            if key not in seen:
                seen[key] = []
                order.append(key)
            for artist in credit.artists:
                if artist not in seen[key]:
                    seen[key].append(artist)

        # Reconstruct using the original role casing from first occurrence
        role_casing: dict[str, str] = {}
        for credit in self.credits:
            key = credit.role.lower().strip()
            if key not in role_casing:
                role_casing[key] = credit.role

        return [
            Credit(role=role_casing[key], artists=seen[key])
            for key in order
            if seen[key]
        ]

    def typed_queue(
        self,
        *,
        include_core: bool = True,
        include_additional: bool = True,
        include_copyright: bool = True,
        include_youtube: bool = True,
        include_cover_art: bool = True,
    ) -> list[tuple[str, str]]:
        """
        Returns a typed queue consumed by the hotkey assistant.

        Ordering matches the Genius metadata form layout:
          1. ("written_by",  <artist>) — Songwriter/Lyricist → Written By field
          2. ("produced_by", <artist>) — Producer → Produced By field
          3. ("role",   <role_name>)   \\
             ("artist", <artist>)       > everything else via Add additional credits
             ...

        Multiple artists in a Written By / Produced By group are entered
        into the same field one by one (the field resets after each selection).

        Toggle flags control which categories appear in the queue.
        """
        written_by: list[str] = []
        produced_by: list[str] = []
        additional: list[Credit] = []

        for credit in self.merged_credits():
            role_lower = credit.role.lower()
            if role_lower in _WRITTEN_BY_ROLES:
                written_by.extend(credit.artists)
            elif role_lower in _PRODUCED_BY_ROLES:
                produced_by.extend(credit.artists)
            else:
                additional.append(credit)

        queue: list[tuple[str, str]] = []
        if include_core:
            for artist in written_by:
                queue.append(("written_by", artist))
            for artist in produced_by:
                queue.append(("produced_by", artist))
        if include_additional:
            for credit in additional:
                queue.append(("role", credit.role))
                for artist in credit.artists:
                    queue.append(("artist", artist))
        if include_copyright:
            if self.phonographic_copyright:
                queue.append(("phonographic_copyright", _copyright_paste_value(self.phonographic_copyright)))
            if self.copyright_notice:
                queue.append(("copyright_notice", _copyright_paste_value(self.copyright_notice)))
            elif self.phonographic_copyright:
                queue.append(("copyright_notice", _copyright_paste_value(self.phonographic_copyright)))
        if include_cover_art:
            if self.cover_art_url:
                queue.append(("cover_art", self.cover_art_url))
        if include_youtube:
            if self.youtube_url:
                queue.append(("youtube_url", self.youtube_url))
        return queue
