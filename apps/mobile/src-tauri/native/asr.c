// whisper.cpp for the app's Rust: a model loaded, German (or any language given) heard from 16 kHz
// samples with the parameters the server's whisper-server uses (greedy, temperature 0, no
// timestamps). The C struct of parameters stays here, out of the Rust bindings.
#include <string.h>
#include "whisper.h"

struct whisper_context * sa_whisper_load(const char * path) {
    struct whisper_context_params params = whisper_context_default_params();
    return whisper_init_from_file_with_params(path, params);
}

/** The text heard, written into `out` (cut at `cap`): its length, or -1 when Whisper failed. */
int sa_whisper_hear(struct whisper_context * ctx, const float * samples, int n, int threads,
                    const char * lang, char * out, int cap) {
    struct whisper_full_params params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
    params.language = lang;
    params.detect_language = false;
    params.n_threads = threads;
    params.temperature = 0.0f;
    params.no_timestamps = true;
    params.print_progress = false;
    params.print_realtime = false;
    params.print_special = false;
    params.print_timestamps = false;
    if (whisper_full(ctx, params, samples, n) != 0) return -1;
    int len = 0;
    out[0] = 0;
    for (int i = 0; i < whisper_full_n_segments(ctx); i++) {
        const char * text = whisper_full_get_segment_text(ctx, i);
        int l = (int) strlen(text);
        if (len + l + 1 > cap) break;
        memcpy(out + len, text, l);
        len += l;
        out[len] = 0;
    }
    return len;
}

void sa_whisper_free(struct whisper_context * ctx) { whisper_free(ctx); }
