// DW-specific text checks (plain text itself comes from course-kit).

/** Labels of DW's player that appear in content fields; not content. */
export const isUiLabel = (text: string) =>
  /^(Прослушать аудио|Play audio|Audio abspielen)$/i.test(text);
