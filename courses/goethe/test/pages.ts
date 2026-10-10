// Synthetic pages shaped like Goethe's accessible model tests (never their content): a module page
// with Teile of each kind the provider reads, and solution pages in both forms.

const player = (n: number) =>
  `<p><a href="javascript: document.getElementById('audio_player${n}').focus();"><strong>Hörsequenz</strong> (.mp4,0.1 MB)</a></p>
   <div class="player_v"><a href="#play"><img src="../medien/play.gif" /></a></div>
   <div id="audio_player${n}" class="alert">Alternativ: <a href="../medien/x/WRONG_${n}.mp4">Hörsequenz</a></div>
   <div id="gebaerden_player${n}" class="alert"><a href="../medien/x/sign_${n}.mp4">Video</a></div>`;

const radio = (name: string, i: number, label: string, extra = "") =>
  `<p><label for="${name}_${i}"><input type="radio" name="${name}" value="${name}_${i}" id="${name}_${i}" ${extra}/>&nbsp;${label}</label></p>`;

/** A listening module: a Teil of picture options (an example first), a Teil answered by letter in a
 *  table with pictures a–c, and a Teil whose recording comes after its questions. */
export const HOEREN = `<html><body>
<div id="nav"><p>Menü</p></div>
<h1><a id="Inhalt"></a>Inhalt</h1>
<p>Reguläre Prüfungszeit: circa 12 Minuten</p>
<h3>Übersicht</h3><ul><li>Teil 1</li></ul>
<h3>Teil 1</h3>
<p>Kreuzen Sie an. Sie hören jeden Text zweimal.</p>
<form id="t_01_1" action="hoeren_l1.php#loesung1" method="post">
  <h4>Beispiel: 0 - Teil 1</h4>${player(0)}
  <fieldset><legend><strong>&nbsp;Wer kommt?</strong></legend>
    <p><img src="../medien/x/bsp_a.gif" alt="Anna" /></p>${radio("t1bsp", 1, "Anna.", 'checked="checked" disabled="disabled"')}
    <p><img src="../medien/x/bsp_b.gif" alt="Ben" /></p>${radio("t1bsp", 2, "Ben.", 'disabled="disabled"')}
  </fieldset>
  <h4>Aufgabe 1</h4>${player(1)}
  <fieldset><legend><strong>Was kostet es?</strong></legend>
    <p><img src="../medien/x/1a.gif" alt="Zehn Euro" /></p>${radio("t1q1", 1, "Zehn Euro.")}
    <p><img src="../medien/x/1b.gif" alt="Elf Euro" /></p>${radio("t1q1", 2, "Elf Euro.")}
  </fieldset>
  <h4>Aufgabe 2 - Du bist im Zug und hörst:</h4>${player(2)}
  <fieldset><legend>Der Zug kommt pünktlich.</legend>${radio("t1q2", 1, "Richtig.")}${radio("t1q2", 2, "Falsch.")}</fieldset>
  <p>maximal 2 Punkte: 0</p>
</form>
<h3>Teil 2</h3>
<p>Sie hören den Text einmal. Wählen Sie ein Bild aus a bis c.</p>
<h4>Beispiel 0 Gesprächstext Teil 2</h4>${player(3)}
<h4>Die Aufgaben 3 bis 4</h4>
<form id="t_01_2" action="hoeren_l2.php#loesung2" method="post">
  <table><tr><th>Beispiel 0</th><th>3</th><th>4</th></tr>
    <tr><th>Tag</th><td>Montag</td><td>Dienstag</td><td>Mittwoch</td></tr>
    <tr><th>Lösung</th><td><input type="text" name="b" value="c" maxlength="1" disabled="disabled"/></td>
      <td><input type="text" name="q3" value="" maxlength="1"/></td><td><input type="text" name="q4" value="" maxlength="1"/></td></tr>
  </table>
  <h4>Die Bilder a bis c</h4>
  <table><tr><td><img src="../medien/x/pa.png" alt="Kino" /> a</td><td><img src="../medien/x/pb.png" alt="Bad" /> b</td><td><img src="../medien/x/pc.png" alt="Park" /> c</td></tr></table>
</form>
<h3>Teil 3</h3>
<p>Sie hören das Gespräch einmal.</p>
<form id="t_01_3" action="hoeren_l3.php#loesung3" method="post">
  <h4>Aufgabe 5</h4><fieldset><legend>Anna ist müde.</legend>${radio("t3q5", 1, "Richtig")}${radio("t3q5", 2, "Falsch")}</fieldset>
  <h4>Aufgabe 6</h4><fieldset><legend>Ben ist …</legend>${radio("t3q6", 1, "a krank.")}${radio("t3q6", 2, "b froh.")}</fieldset>
  ${player(4)}
</form>
<h3>Gesamtergebnis Hören:</h3><p>Teile 1 bis 3</p>
<script>
var audio = [
  '../medien/x/bsp1.mp4',
  '../medien/x/q1.mp4',
  '../medien/x/q2.mp4',
  '../medien/x/teil2.mp4',
  '../medien/x/teil3.mp4 ',
]
</script>
</body></html>`;

/** A reading module: a text before the form, then ads after it answered by letter ("X": none). */
export const LESEN = `<html><body><h1><a id="Inhalt"></a></h1>
<p>Reguläre Prüfungszeit: 8 Minuten</p>
<h3>Teil 1</h3>
<p>Lesen Sie den Text.</p>
<h4>Text - Teil 1</h4>
<h5>Ein Brief</h5>
<p>Liebe Ute, ich komme morgen.</p>
<form id="t_02_1" action="lesen_l1.php#loesung1" method="post">
  <h4>Aufgaben - Teil 1 Beispiel 0 - Teil 1</h4>
  <fieldset><legend>Ute bekommt …</legend>${radio("l1b", 1, "a einen Brief.", 'checked="checked" disabled="disabled"')}${radio("l1b", 2, "b ein Paket.", 'disabled="disabled"')}</fieldset>
  <h4>Aufgabe 1</h4>
  <fieldset><legend>Wer kommt?</legend>
    <img src="../medien/x/brief.jpg" alt="Ein Zettel" longdesc="../medien/x/zettel.html" />
    <a href="../medien/x/zettel.html">Textinhalt der Abbildung</a>
    ${radio("l1q1", 1, "a der Vater.")}${radio("l1q1", 2, "b der Freund.")}
  </fieldset>
</form>
<h3>Teil 2</h3>
<p>Welche Anzeige passt? Für eine Aufgabe gibt es keine Lösung. Schreiben Sie hier den Buchstaben X.</p>
<form id="t_02_2" action="lesen_l2.php#loesung2" method="post">
  <h5>Aufgabe 2</h5><fieldset><legend>Eva sucht ein Café.</legend><label for="q2">Anzeige:</label><input type="text" id="q2" value="" maxlength="1"/></fieldset>
  <h5>Aufgabe 3</h5><fieldset><legend>Max sucht ein Kino.</legend><label for="q3">Anzeige:</label><input type="text" id="q3" value="" maxlength="1"/></fieldset>
</form>
<h4>Internet Anzeigen</h4>
<h5>Anzeige a</h5><p>www.cafe.example</p><p>Kuchen und Kaffee.</p><p>Zu den Aufgaben Teil 2</p>
<h5>Anzeige b</h5><p>www.bad.example</p><p>Schwimmen am See.</p>
<h3>Gesamtergebnis Lesen:</h3>
</body></html>`;

export const ZETTEL = `<html><head><title>Text</title></head><body><p>Hallo Ute,</p>der Vater kommt.<br/>Bis bald<p><a href="../../lesen.php">zurück zu Teil 1</a></p><script>track()</script></body></html>`;

const list = (rows: Array<[number, string]>) =>
  `<html><body><ul>${rows
    .map(
      ([n, a]) =>
        `<li><span><strong>&nbsp;${n}&nbsp;</strong></span><span class="schrift_rot2">Lösung: ${a}</span><span><br/>Ihre Auswahl:</span></li>`,
    )
    .join("")}</ul></body></html>`;
const table = (rows: Array<[number, string]>) =>
  `<html><body><table><thead><tr><th>Aufgabe</th><th>Ihre Antwort</th><th>Richtige Antwort</th><th>Punkte</th></tr></thead><tbody>${rows
    .map(([n, a]) => `<tr><th>&nbsp;${n}</th><td>&nbsp;</td><td>${a}</td><td> 0 </td></tr>`)
    .join("")}</tbody></table></body></html>`;

export const SOLUTIONS: Record<string, string> = {
  "hoeren_l1.php": list([
    [1, "Elf Euro."],
    [2, "Richtig."],
  ]),
  "hoeren_l2.php": table([
    [3, "b"],
    [4, "a"],
  ]),
  "hoeren_l3.php": list([
    [5, "Falsch"],
    [6, "b froh."],
  ]),
  "lesen_l1.php": list([[1, "b der Freund."]]),
  // A page numbering its own Teil from 1 (its questions are 2 and 3).
  "lesen_l2.php": table([
    [1, "a"],
    [2, "x"],
  ]),
};

/** A writing module: a form to fill in (a field filled in, gaps, a choice), a text judged per point
 *  with each level's points (A1), one by bands A–E in a table with its voiding note (A2), and one by
 *  maxima with a picture and its text page (B1). */
export const SCHREIBEN = `<html><body><h1><a id="Inhalt"></a></h1>
<p>Reguläre Prüfungszeit: circa 30 Minuten</p>
<h3>Übersicht</h3><ul><li>Teil 1</li></ul>
<div><h3>Teil 1</h3>
<p>Tom bucht einen Kurs. Er zahlt bar.<br/>Helfen Sie Tom.</p>
<form action="schreiben_l1.php#loesung22" method="post" id="t_03_1">
  <h4>Kurs <br/><span>Anmeldung</span></h4>
  <p><label for="t_bsp0">Name:</label></p><p><input name="t_bsp0" id="t_bsp0" value="Tom Weber" readonly="readonly"/> - <span>Beispiel (0)</span></p>
  <p><label for="t_1">Alter:</label></p><p><input name="t_1" id="t_1" value="(1)" onblur="x"/></p>
  <p>Der Kurs ist zu bezahlen.</p>
  <p>Zahlung:&nbsp;&nbsp;(2)</p>
  <p><label for="t_2_1"><input type="radio" name="t_2" id="t_2_1"/>&nbsp;Bar</label><br/>
     <label for="t_2_2"><input type="radio" name="t_2" id="t_2_2"/>&nbsp;Karte</label></p>
  <p>maximal 2 Punkte:<strong>0</strong></p>
  <input type="submit" value="Zu den Lösungen - Teil 1"/>
</form></div>
<div><h3>Teil 2</h3>
<p>Schreiben Sie an die Schule:</p>
<ul><li>Warum schreiben Sie?</li><li>Fragen Sie: Preis?</li></ul>
<p>Schreiben Sie auch eine Anrede und einen Gruß.</p></div>
<form action="schreiben.php?#t2" method="post" id="t_03_2"><h4>Teil 2: <label for="t2">Eingabetextfeld</label></h4><textarea id="t2"></textarea></form>
<div class="bewertung"><h4>Bewertung:</h4>
<p><strong>Erfüllung der Aufgabenstellung (pro Inhaltspunkt)</strong></p>
<ul><li><strong>3 Punkte</strong>&nbsp;-&nbsp;voll erfüllt</li><li><strong>1,5 Punkte</strong>&nbsp;-&nbsp;teilweise</li><li><strong>0 Punkte</strong>&nbsp;-&nbsp;nicht erfüllt</li></ul>
<p><strong>Kommunikative Gestaltung des Textes</strong></p>
<ul><li><strong>1 Punkt</strong> - angemessen</li><li><strong>0,5 Punkte</strong> - keine Anrede</li><li><strong>0 Punkte</strong> - unangemessen</li></ul></div>
<p><a href="schreiben_p2.php"><img src="../medien/print.gif" alt="Druckersymbol"/>Teil 2 drucken</a></p>
<h3>Teil 3</h3>
<p>Schreiben Sie eine SMS.</p>
<form action="schreiben.php?#t3" method="post" id="t_03_3"><h4>Teil 3: <label for="t3">Eingabetextfeld</label></h4><textarea id="t3"></textarea></form>
<table><tr><th></th><th>A</th><th>B</th></tr>
<tr><th>Aufgabenerfüllung* -<br/>Inhalt</th><td>alles</td><td>wenig</td></tr>
<tr><th>Aufgabenerfüllung* -<br/>Register</th><td>passend</td></tr>
<tr><th>Sprache -<br/>Spektrum: Wortschatz</th><td>reich</td><td>arm</td></tr></table>
<p>*Wird das Kriterium “Aufgabenerfüllung” mit E (0 Punkten) bewertet, ist die Punktzahl 0 Punkte.</p>
<h3>Aufgabe 4</h3>
<p>Reguläre Prüfungszeit: 10 Minuten</p>
<p>Im Forum lesen Sie:</p>
<p><img src="../medien/x/forum.jpg" alt="Ein Forum. Text unter dem Link."/></p>
<p><a href="../medien/x/forum.html"><strong>Textinhalt Forum</strong></a></p>
<form action="schreiben.php?#t4" method="post" id="t_03_4"><h4>Aufgabe 4: <label for="t4">Ihre Meinung</label></h4><textarea id="t4"></textarea></form>
<div><h4>Bewertet werden:</h4><ul><li><strong>Erfüllung</strong>&nbsp;-&nbsp;maximal 4 Punkte</li><li><strong>Wortschatz</strong> - maximal 6 Punkte</li></ul></div>
<h3>Gesamtergebnis</h3><p>Konzept: niemand</p>
</body></html>`;

/** Its form's solution page: a table, alternatives with " / ". */
export const SCHREIBEN_L1 = table([
  [1, "20 / zwanzig"],
  [2, "bar"],
]);

/** A speaking module: questions to introduce oneself, cards by theme, candidate A's and B's cards with
 *  a calendar's text page each, and a page listing the criteria' maxima (one for every part). */
export const SPRECHEN = `<html><body><h1><a id="Inhalt"></a></h1>
<p>Reguläre Prüfungszeit: 12 Minuten</p>
<h3>Teil 1</h3><p>Sich vorstellen.</p><h4>Name?</h4><h4>Alter?</h4>
<h3>Teil 2</h3><p>Fragen stellen.</p>
<p><img src="../medien/x/k1.gif" alt="Karte mit Kopfbereich: Test, Thema Essen und Inhaltsbereich: Brot"/></p>
<p><img src="../medien/x/k2.gif" alt="Karte mit Kopfbereich: Test, Thema Essen und Inhaltsbereich: Milch"/></p>
<p>Prüfungsteilnehmer/-in B</p>
<p><img src="../medien/x/kb.gif" alt="Karte B, Inhaltsbereich: Wochenende?"/></p>
<p>...</p>
<h3>Teil 3 - Prüfungsteilnehmer/-in A</h3><p>Finden Sie einen Termin.</p>
<p><img src="../medien/x/ka.png" alt="Kalender A - Inhalt im folgenden Link"/></p><a href="../medien/x/kal_a.html">Text</a>
<h3>Teil 3 - Prüfungsteilnehmer/-in B</h3><p>Finden Sie einen Termin.</p>
<p><img src="../medien/x/kb.png" alt="Kalender B - Inhalt im folgenden Link"/></p><a href="../medien/x/kal_b.html">Text</a>
<h3>Bewertung:</h3>
<p>Aufgabe 2</p><ul><li>maximal 4 Punkte - Erfüllung</li></ul>
<p>Aufgabe 1, 2, 3</p><ul><li>maximal 6 Punkte - Aussprache</li></ul>
<p>Konzept/Koordination: niemand</p>
</body></html>`;
