import type { QueueKind } from "../core/models";

export const FIELD_LABELS: Readonly<Record<QueueKind, string>> = {
  written_by: "Written By",
  produced_by: "Produced By",
  role: "Additional role",
  artist: "Artist in this role",
  copyright_role: "Copyright role",
  phonographic_copyright: "℗ label",
  copyright_notice: "© label",
  youtube_url: "YouTube URL",
  cover_art: "Cover art URL",
  release_month: "Release month",
  release_day: "Release day",
  release_year: "Release year",
};
