// Every error the API answers with (06, "Errors"): `{ error: <code> }`, the code one of these. The
// server raises only these; the web shows each in words (`error.<code>` in its catalogs, tested).

export const ERROR_CODES = [
  // The app and its session.
  "no_session",
  "missing_client_header",
  "unknown_host",
  "not_found",
  "invalid_request",
  "request_too_large",
  "server_error",
  // Profiles.
  "no_such_profile",
  "name_required",
  "registration_closed",
  "no_device",
  // A profile file: exported, imported (05, "Profile file").
  "profile_export_gone",
  "not_a_profile_file",
  "profile_file_damaged",
  "profile_file_too_large",
  "profile_from_newer_app",
  "not_enough_space",
  // Courses and downloads.
  "not_installed",
  "not_offered",
  "downloads_unavailable",
  "lesson_not_in_series",
  // Lesson runs and their events.
  "no_such_run",
  "run_not_active",
  "run_without_edition",
  "run_incomplete",
  "no_such_item",
  "no_such_attempt",
  "answer_does_not_fit",
  "invalid_event",
  "event_of_another_run",
  "event_id_taken",
  // Exam runs.
  "exam_needs_setting",
  "exam_time_over",
  "exam_test_running",
  // Cards and review.
  "no_such_card",
  "card_changed",
  "nothing_to_undo",
  // Imported decks.
  "no_such_deck",
  "not_a_deck",
  "deck_without_words",
  "deck_too_large",
  "deck_in_use",
  "deck_upload_gone",
  "deck_unpacked_too_large",
  "deck_same_languages",
  // Settings.
  "unknown_setting",
  "invalid_setting",
  // Recordings and speech.
  "empty_recording",
  "recording_too_large",
  "unsupported_audio",
  "no_such_recording",
  "speech_unavailable",
  "speech_engine_failed",
  "no_such_model",
  // The AI assistant: its work in lessons, its setup, its providers (`llm_<LlmError code>`).
  "no_lesson_run",
  "no_such_chat",
  "no_course_studied",
  "ai_place_off",
  "no_active_scene",
  "writing_busy",
  "scene_busy",
  "speaking_busy",
  "examples_without_word",
  "exam_rating_busy",
  "exam_conversation_busy",
  "exam_part_done",
  "llm_not_configured",
  "llm_no_endpoint",
  "llm_no_key",
  "llm_cli_missing",
  "llm_lmstudio_missing",
  "llm_lmstudio_remote",
  "llm_lmstudio_failed",
  "llm_unreachable",
  "llm_unauthorized",
  "llm_model_not_found",
  "llm_timeout",
  "llm_bad_response",
  "llm_rate_limited",
  "llm_invalid_output",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Whether a text the API answered with is one of its codes (an older server may send others). */
export const isErrorCode = (text: string): text is ErrorCode =>
  (ERROR_CODES as readonly string[]).includes(text);
