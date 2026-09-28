"""Local (lexical) topic de-duplication for the exercise generator.  Standard library only, no model involved.

Method (traditional information retrieval / computational linguistics):
    sentence -> keep only Chinese characters -> cut at stop words -> content fragments
             -> overlapping character bigrams = the sentence's "topic features"
Two sentences are about the same thing when they share a topic feature that is not generic.

* stop words   stopwords_zh.txt      public list (goto456/stopwords, cn_stopwords.txt), imported once, do not edit
               stopwords_domain.txt  yours: words that are too common in this app (德国, 德语, ...), edit any time
* generic      a bigram found in more than GENERIC_RATIO of the last WINDOW questions is ignored automatically
               (only once at least GENERIC_MIN_DOCS questions exist; before that only the stop word files count)
* cooldown     topic features of the last WINDOW questions, minus the generic ones

server.py exposes this as  GET /api/topics/cooldown  and  POST /api/topics/filter.  The page asks the model to
avoid the cooldown words (one short line instead of ten session summaries) and filters what comes back.
Everything here is deterministic and costs no tokens.

Known limit: it only sees shared *words*.  Same topic in different words (学校/大学, 医生/看病) is not caught.

English / German exercise sentences (v0.2, when the explanation language is en or de) use the same machinery with
words instead of character bigrams:  sentence -> lower-case words -> drop stop words (stopwords_en.txt /
stopwords_de.txt, which also list time words; a word whose stem equals a stop word's stem is dropped too, so
"finish" in the file also removes "finished") -> crude stem (plural / verb endings cut, first 7 letters) = features.
"""
import json
import os
import random
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone

# ---------------------------------------------------------------------------------- all tunable numbers live here
CONFIG = {
    "WINDOW": 30,               # how many recent questions define "recent topics"
    "GENERIC_RATIO": 0.20,      # a bigram in MORE than this share of the window's questions counts as generic
    "GENERIC_MIN_DOCS": 20,     # fewer questions than this: the generic statistic is not used
    "MAX_HINT_WORDS": 20,       # most topic words sent to the model in the "avoid these" line
    "HINT_MAX_LEN": 4,          # longest fragment (characters) in that line
    "MAX_RETRIES": 1,           # the page regenerates the missing sentences at most this many times
    "OVERGENERATE": 2,          # the page asks for this many sentences more than it needs: the filter rejects some
    "MIN_KEEP": 3,              # retry (once) only when fewer than this many sentences survived the filter
    "SINGLE_CHAR_STOP": "file", # "file": single characters in the stop word files cut sentences (大, 的, 在 ...)
                                # "multi_only": only multi-character stop words cut (single characters are ignored)
    "INTRA_BATCH": True,        # sentences kept earlier in the same batch also count as "recent" for the next ones
    "TIME_CUT": True,           # cut at time / quantity expressions (今天, 周末, 二十分钟, 三本 ...): not topics
    "MIN_SHARED": 1,            # a candidate is rejected when it shares at least this many blocked bigrams
    # v0.4: grammar points the student keeps getting wrong come first
    "WEAK_WINDOW": 4,           # look at the last this many answers per grammar point
    "WEAK_RATIO": 0.5,          # ... a point is "weak" when at least this share of them was wrong
    "WEAK_SLOTS": 2,            # at most this many weak points go to the front of each batch
    "WEAK_COOLDOWN": 3,         # a weak point used in one of the last this many exercises waits (no drilling)
    # v0.5: grammar points by CEFR level (German): every LOWER_EVERY-th exercise revises the level below
    "LOWER_EVERY": 5,
}

# v0.1-v0.4 German list (no levels).  Kept so that an unchanged old list in the database can be recognised and
# replaced by the levelled one below; a list the student edited is left alone.
GRAMMAR_FOCI = [
    'Nebensatz mit weil/obwohl/dass', 'Passiv', 'Konjunktiv II', 'Relativsatz',
    'Präpositionen mit Akkusativ/Dativ', 'Modalverben', 'Perfekt und Präteritum', 'Genitiv',
    'um … zu / Infinitivsatz', 'Adjektivdeklination', 'reflexive Verben', 'Wechselpräpositionen',
    'Komparativ und Superlativ', 'indirekte Rede', 'Verben mit festen Präpositionen',
]

# v0.5: grammar points per CEFR level, merged into points that fit a one-sentence translation.  Sources:
#   German  - a university curriculum overview A1-C2 (Bard College, German Studies, "Niveaustufen Übersicht", 2021)
#   English - British Council / Eaquals "Core Inventory for General English" (2nd ed. 2015, A1-C1)            (v0.7)
#   French  - CASNAV de Lille "Contenus clés en grammaire du niveau A1 au niveau B2" (2017), C1 from the usual
#             FLE contents (passé simple, concordance des temps, registres ...)                              (v0.7)
# Goethe publishes no grammar inventory for C1 ("gibt es nicht"), the Core Inventory stops at C1 and no French list goes
# past B2/C1: by the end of B2 the grammar system is complete, so C1 and C2 share ONE list per language: the few
# structures that are really new there, and rewriting (nominal style, register).  Keys are level groups: A1 A2 B1 B2 C1 (C2 uses C1).
LEVEL_GROUPS = ("A1", "A2", "B1", "B2", "C1")
GRAMMAR_FOCI_LEVELED = {
    "de": {
        "A1": [
            "W-Fragen und Ja/Nein-Fragen", "Verbzweitstellung im Aussagesatz", "Präsens (auch haben, sein, unregelmäßige Verben)",
            "bestimmter/unbestimmter Artikel und kein", "Akkusativ (Artikel, Pronomen, Verben mit Akkusativ)", "Possessivartikel",
            "Modalverben und Satzklammer", "trennbare Verben", "Imperativ", "Perfekt mit haben und sein",
            "Dativ (Artikel, Pronomen, Verben mit Dativ)", "Präpositionen mit Akkusativ oder Dativ (für, mit, in, zu …)",
            "Zeitangaben (am, um, im, von … bis)", "Sätze verbinden: und, oder, aber, denn", "Präteritum von haben und sein",
        ],
        "A2": [
            "Nebensatz mit weil, dass, wenn", "Modalverben im Präteritum", "Komparativ und Superlativ, Vergleiche mit als und wie",
            "reflexive Verben", "Adjektivdeklination nach Artikel", "Konjunktiv II: könnte, sollte, würde (Höflichkeit, Rat)",
            "indirekte Fragen (W-Wort / ob)", "Wechselpräpositionen (liegen/legen, stehen/stellen …)", "deshalb und trotzdem",
            "Verben mit Dativ und Akkusativ", "als und wenn (Vergangenheit)", "Verben mit Präpositionen, wo(r)- und da(r)-",
            "Relativsätze im Nominativ und Akkusativ",
        ],
        "B1": [
            "Infinitiv mit zu", "lassen", "Nebensatz mit obwohl", "Genitiv, wegen und trotz", "Präteritum",
            "bevor, nachdem, seit(dem), während", "Folgen: sodass, so … dass, deswegen",
            "Konjunktiv II: irreale Wünsche und Bedingungen", "Pronominaladverbien (dafür, darauf …)", "n-Deklination", "Futur I",
            "Relativsätze mit Dativ, Präposition, was und wo", "Plusquamperfekt",
            "zweiteilige Konnektoren (nicht nur … sondern auch, weder … noch …)", "Adjektivdeklination ohne Artikel",
            "Stellung von nicht", "Passiv (Präsens, Präteritum, Perfekt, mit Modalverb)", "je … desto", "Partizip I und II als Adjektiv",
        ],
        "B2": [
            "um … zu, ohne … zu, (an)statt … zu", "Finalsätze mit damit", "Relativsätze mit wer", "Nomen-Verb-Verbindungen",
            "Zustandspassiv und Passiversatzformen (sich lassen, -bar, sein … zu)", "als ob / als wenn mit Konjunktiv II",
            "indem / dadurch, dass", "Verben, Nomen und Adjektive mit Präpositionen", "indirekte Rede mit Konjunktiv I",
            "Nominalisierung", "Modalpartikeln (doch, ja, eben, halt …)", "erweiterte Partizipialattribute",
            "während (adversativ) und wohingegen", "Präpositionen mit Genitiv (innerhalb, aufgrund, trotz …)",
            "das Wort „es“ (Platzhalter, Korrelat)",
        ],
        "C1": [
            "subjektive Modalverben (soll/will … haben, muss/dürfte …)", "modales Partizip (die zu lösende Aufgabe)",
            "Infinitiv Perfekt (… gesehen zu haben)", "scheinen, drohen, pflegen + zu",
            "Konditionalsätze ohne wenn (Sollte …, Hätte …)", "Nominal- und Verbalstil umformen (weil … ↔ wegen …)",
            "Funktionsverbgefüge (zur Verfügung stellen, in Kraft treten …)",
            "Konnektoren (folglich, andernfalls, vielmehr, allerdings …)", "zu …, als dass",
            "Konjunktiv II der Vergangenheit (nachträgliche Kritik)", "Redewiedergabe (Konjunktiv I, laut, zufolge …)",
            "weiterführende Nebensätze und Subjekt-/Objektsätze",
        ],
    },
    "en": {
        "A1": [
            "to be and there is / there are", "present simple", "present continuous", "past simple (incl. was / were)",
            "going to for plans", "can / can't", "questions (yes/no and wh-questions)", "imperatives",
            "personal pronouns and possessive adjectives", "possessive 's", "articles a / an / the",
            "prepositions of time and place (in / on / at)", "adverbs of frequency", "like / love / hate + -ing",
        ],
        "A2": [
            "present perfect (ever / never / just / yet)", "past continuous", "will vs. going to",
            "present continuous for future arrangements", "comparatives and superlatives",
            "countable and uncountable nouns (much / many / some / any)", "have to / should",
            "would like and polite requests with could", "zero and first conditional", "verb + -ing or to-infinitive",
            "common phrasal verbs", "used to for past habits", "adverbials of time and place and their word order",
            "object and subject questions",
        ],
        "B1": [
            "present perfect vs. past simple", "present perfect continuous", "past perfect", "second conditional",
            "third conditional", "simple passive", "reported speech", "relative clauses (who / which / that / whose)",
            "modals of deduction (must / might / can't)", "should have / might have + past participle", "too / enough",
            "connectors of cause, contrast and result (because of, although, so)", "question tags", "future continuous",
            "gerund vs. infinitive with change of meaning (stop, remember, try)", "indirect questions",
        ],
        "B2": [
            "mixed conditionals", "wish / if only", "passive forms incl. modals and have something done",
            "past modals (could have / needn't have / can't have)", "future perfect and future perfect continuous",
            "narrative tenses (past perfect continuous)", "non-defining relative clauses",
            "reporting verbs (suggest, deny, admit, advise)", "would for past habits",
            "phrasal verbs: separable and inseparable", "participle clauses", "articles with abstract and generic nouns",
            "linking words for argument (whereas, despite, however)", "causative have / get",
            "it as a preparatory subject or object",
        ],
        "C1": [
            "inversion after negative adverbials (Never have I …, Not only …)",
            "cleft sentences (It was … that, What I need is …)", "inverted conditionals (Had I known …, Should you …)",
            "impersonal passives (It is said that …, He is believed to …)", "past modals of speculation and criticism",
            "nominalisation and formal register", "reduced relative clauses",
            "subjunctive and formal should (It is essential that he be …)", "emphasis: fronting and emphatic do",
            "ellipsis and substitution (so, do so, not)",
            "concession in formal style (albeit, nonetheless, notwithstanding)",
            "hedging (It would appear that …, tends to …)",
        ],
    },
    "fr": {
        "A1": [
            "présent de l'indicatif (être, avoir, verbes en -er et verbes usuels)", "futur proche (aller + infinitif)",
            "passé composé avec avoir et être", "passé récent (venir de + infinitif)", "négation (ne … pas, ne … jamais)",
            "questions (est-ce que, inversion, mots interrogatifs)", "articles définis, indéfinis et partitifs",
            "masculin / féminin, singulier / pluriel", "place et accord de l'adjectif",
            "adjectifs possessifs et démonstratifs", "pronoms compléments COD et COI",
            "prépositions de lieu, villes et pays (à, au, en, chez)", "il y a / il faut + infinitif",
            "verbes modaux (pouvoir, vouloir, devoir) + infinitif", "conditionnel de politesse (je voudrais)",
        ],
        "A2": [
            "imparfait", "passé composé ou imparfait", "futur simple", "impératif avec pronoms", "verbes pronominaux",
            "négation (ne … plus / personne / rien)", "comparaison (plus / moins / aussi … que)",
            "pronoms relatifs qui, que, où", "pronoms possessifs et démonstratifs", "pronoms y et en",
            "discours indirect au présent", "si + présent + futur", "indicateurs de temps (depuis, il y a, dans, pendant)",
            "subjonctif présent après il faut que", "gérondif (en + participe présent)",
        ],
        "B1": [
            "plus-que-parfait", "futur antérieur", "temps du passé dans le récit",
            "conditionnel présent (souhait, conseil, hypothèse)", "si + imparfait + conditionnel",
            "subjonctif (volonté, sentiment, obligation)", "voix passive", "accord du participe passé (avec être et avoir)",
            "discours indirect au passé et concordance des temps", "pronoms relatifs dont et lequel / auquel / duquel",
            "double pronominalisation (je le lui donne)", "mise en relief (ce qui / ce que / c'est … qui)",
            "négation (ne … que, aucun, ni … ni)", "participe présent et adjectif verbal",
            "concession (bien que + subjonctif, malgré, pourtant)", "but (pour que, afin de)",
        ],
        "B2": [
            "conditionnel passé", "si + plus-que-parfait + conditionnel passé", "subjonctif passé",
            "subjonctif ou indicatif (croire, penser, espérer …)", "nominalisation",
            "cause et conséquence (puisque, étant donné que, si bien que, de sorte que)",
            "concession (quoique, même si, néanmoins)", "condition (à condition que, pourvu que, à moins que)",
            "expression du temps (dès que, avant que, jusqu'à ce que)",
            "y et en avec verbes à préposition (penser à → y penser)",
            "participe passé composé et proposition participiale (ayant fini …)", "adverbes en -ment",
            "faire + infinitif (faire faire, se faire)", "articulateurs de l'argumentation (d'une part …, en revanche, or)",
        ],
        "C1": [
            "passé simple (récit écrit)", "subjonctif imparfait et plus-que-parfait (reconnaissance)",
            "concordance des temps (antériorité, simultanéité, postériorité)",
            "hypothèse sans si (au cas où, à supposer que, en admettant que)",
            "conditionnel de l'information non confirmée (selon …, il aurait …)",
            "inversion du sujet (Peut-être viendra-t-il …)", "nominalisation et style écrit",
            "registres de langue (soutenu / courant / familier)", "propositions participiales et appositions",
            "ne explétif (avant qu'il ne parte, à moins que …)",
            "articulateurs logiques avancés (dès lors, en l'occurrence, quand bien même)",
            "mise en relief avancée (c'est … que, ce dont …, c'est …)",
        ],
    },
}


def level_group(level):
    """A1 ... C2 -> the key of the list to use (C2 -> C1).  Anything else -> None (= no level filter)."""
    lv = (level or "").upper()
    return "C1" if lv == "C2" else (lv if lv in LEVEL_GROUPS else None)


def lower_group(group):
    i = LEVEL_GROUPS.index(group) if group in LEVEL_GROUPS else 0
    return LEVEL_GROUPS[i - 1] if i > 0 else None


def mix_foci(ranked_cur, ranked_lower, k, weak=(), every=None):
    """Weak points first, then the current level with every EVERY-th slot taken from the level below (revision).
    Both input lists are already ranked (rank_foci); nothing appears twice."""
    every = every or CONFIG["LOWER_EVERY"]
    pool = set(ranked_cur) | set(ranked_lower)
    out = [f for f in dict.fromkeys(weak) if f in pool]
    cur = [f for f in ranked_cur if f not in out]
    low = [f for f in ranked_lower if f not in out]
    while len(out) < k and (cur or low):
        take_low = low and (not cur or (len(out) + 1) % every == 0)
        out.append((low if take_low else cur).pop(0))
    return out[: max(0, k)]


# v0.2: one list per language that can be learned.  server.py puts them into the grammar_foci table on first
# start; after that the table is what counts (it can be edited through PUT /api/foci).
GRAMMAR_FOCI_BY_LANG = {
    "de": GRAMMAR_FOCI,
    "en": [
        'present perfect vs. simple past', 'conditional sentences (if-clauses)', 'passive voice', 'relative clauses',
        'reported speech', 'modal verbs', 'articles (a / an / the / no article)', 'countable and uncountable nouns',
        'gerund vs. infinitive', 'phrasal verbs', 'comparatives and superlatives', 'prepositions of time and place',
        'future forms (will / going to / present continuous)', 'questions and question tags',
        'linking words (although, however, despite)',
    ],
    "zh": [
        '把字句', '被字句', '了（完成与变化）', '过（经历）', '着（持续）', '量词', '结果补语 / 趋向补语', '程度补语（得）',
        '比较句（比 / 没有 / 跟…一样）', '是…的 强调句', '虽然…但是 / 因为…所以', '如果…就 / 只要…就',
        '能愿动词（能 / 会 / 可以）', '存现句（有 / 在 / 着）', '时间和地点状语的语序',
    ],
    "fr": [
        'passé composé vs. imparfait', 'auxiliaire être ou avoir', 'accord du participe passé', 'subjonctif présent',
        'phrases conditionnelles (si + imparfait / conditionnel)', 'pronoms compléments (le, lui, en, y)',
        'pronoms relatifs (qui, que, dont, où)', 'articles partitifs (du, de la, des)',
        'prépositions et contractions (au, du, à, en)', 'futur simple et futur proche',
        'négation (ne … pas / jamais / plus / rien)', 'comparatif et superlatif', 'discours indirect',
        'verbes pronominaux', 'gérondif (en + participe présent)',
    ],
}
LATIN_FILES = {"en": "stopwords_en.txt", "de": "stopwords_de.txt"}      # source sentences written in these languages

GENERAL_FILE = "stopwords_zh.txt"
DOMAIN_FILE = "stopwords_domain.txt"
LOG_FILE = "topic_filter.log"


def _is_han(ch):
    return "一" <= ch <= "鿿"


# Time and quantity expressions are a closed grammatical class that the public stop word list does not cover.
# They are cut like stop words (the spec: "cut at stop words / function words / time words").
_NUM = "[0-9零〇一二两三四五六七八九十百千半几]"
_UNIT = ("分钟|小时|钟头|秒|天|日|周|星期|个月|月|年|岁|点钟|点|次|遍|回|本|杯|张|条|件|盒|份|位|只|把|双|套|辆|"
         "门|家|种|些|块|元|欧元|公里|米|倍|个")
TIME_RE = re.compile(
    "[今昨前明后每][天日晚]|[今昨明前后去]年|[上下这本每]个?(?:月|周|星期|礼拜)|(?:星期|礼拜|周)[一二三四五六日天]|周末|"
    "早上|上午|中午|下午|晚上|傍晚|清晨|深夜|凌晨|第[一二三四五六七八九十]+天|"
    + _NUM + "+多?(?:个)?(?:" + _UNIT + ")"
)


# ---------------------------------------------------------------------------------- stop words
def read_word_file(path):
    """One word per line; blank lines and everything after # are ignored.  Missing file -> []."""
    try:
        with open(path, encoding="utf-8-sig") as f:
            lines = f.read().splitlines()
    except OSError:
        return []
    out = []
    for line in lines:
        w = line.split("#", 1)[0].strip()
        if w:
            out.append(w)
    return out


class StopWords:
    """general: words of the public list.  domain: the user's own file; a line "-大" REMOVES a word from the
    merged set (for public-list entries that cut real content words, e.g. 大 in 大学)."""

    def __init__(self, general=(), domain=(), single_mode="file"):
        self.multi = {w for w in general if len(w) > 1}
        self.single = {w for w in general if len(w) == 1} if single_mode == "file" else set()
        removed = set()
        for w in domain:                      # the user's own words always apply, whatever the mode
            if w.startswith("-") and len(w) > 1:
                removed.add(w[1:])
            else:
                (self.multi if len(w) > 1 else self.single).add(w)
        self.multi -= removed
        self.single -= removed
        self.max_len = max((len(w) for w in self.multi), default=1)
        self.missing_general = not general


_sw_cache = {}


class LatinStop:
    """Stop words of an English or German source sentence (one file, lower case)."""

    def __init__(self, lang, words=()):
        self.lang = lang
        self.words = {w.casefold() for w in words}
        # stems too, so the file only needs the base form: "finish" also stops finished / finishes / finishing
        self.stems = {stem(w, lang) for w in self.words}
        self.missing_general = not self.words

    def stops(self, word):
        """word: lower case.  A stop word itself, or a form of one (same crude stem)."""
        if word in self.words or word.strip("'’-") in self.words or stem(word, self.lang) in self.stems:
            return True
        if self.lang == "en":                                # short verbs the stemmer leaves alone: hoped, loves, hoping
            if word[-1:] in ("d", "s") and word[:-1] in self.words:
                return True
            if word.endswith("ing") and word[:-3] + "e" in self.words:
                return True
        return False


def load_stopwords(base_dir, cfg=CONFIG, lang="zh"):
    """lang = the language the exercise sentences are written in (the explanation language).
    The files are re-read when their modification time changes, so edits apply without a restart."""
    if lang in LATIN_FILES:
        path = os.path.join(base_dir, LATIN_FILES[lang])
        try:
            stamp = os.stat(path).st_mtime_ns
        except OSError:
            stamp = None
        hit = _sw_cache.get((base_dir, lang))
        if hit and hit[0] == stamp:
            return hit[1]
        sw = LatinStop(lang, [w for line in read_word_file(path) for w in line.split()])      # several words per line are fine
        _sw_cache[(base_dir, lang)] = (stamp, sw)
        return sw
    paths = [os.path.join(base_dir, GENERAL_FILE), os.path.join(base_dir, DOMAIN_FILE)]
    stamp = []
    for p in paths:
        try:
            stamp.append(os.stat(p).st_mtime_ns)
        except OSError:
            stamp.append(None)
    key = (tuple(stamp), cfg["SINGLE_CHAR_STOP"])
    hit = _sw_cache.get(base_dir)
    if hit and hit[0] == key:
        return hit[1]
    sw = StopWords(read_word_file(paths[0]), read_word_file(paths[1]), cfg["SINGLE_CHAR_STOP"])
    _sw_cache[base_dir] = (key, sw)
    return sw


# ---------------------------------------------------------------------------------- features
def segments(text, sw, time_cut=True):
    """Chinese characters only; cut wherever a stop word (longest match first), a time / quantity expression or a
    non-Chinese character occurs."""
    text = text or ""
    if time_cut:
        text = TIME_RE.sub("|", text)
    out, cur, i, n = [], [], 0, len(text)
    while i < n:
        ch = text[i]
        if not _is_han(ch):
            if cur:
                out.append("".join(cur)); cur = []
            i += 1
            continue
        hit = 0
        for size in range(min(sw.max_len, n - i), 0, -1):
            w = text[i:i + size]
            if not all(_is_han(c) for c in w):
                continue
            if (size > 1 and w in sw.multi) or (size == 1 and w in sw.single):
                hit = size
                break
        if hit:
            if cur:
                out.append("".join(cur)); cur = []
            i += hit
        else:
            cur.append(ch)
            i += 1
    if cur:
        out.append("".join(cur))
    return out


def bigrams_of(seg):
    return {seg[i:i + 2] for i in range(len(seg) - 1)}


class Features:
    __slots__ = ("text", "segments", "bigrams")

    def __init__(self, text, sw, time_cut=True):
        self.text = text
        self.segments = segments(text, sw, time_cut)
        self.bigrams = set()
        for s in self.segments:
            self.bigrams |= bigrams_of(s)


LATIN_WORD_RE = re.compile(r"[^\W\d_]+(?:['’\-][^\W\d_]+)*")
_SUFFIXES = {
    "en": (("ings", ""), ("ing", ""), ("ies", "y"), ("ied", "y"), ("es", ""), ("ed", ""), ("s", "")),
    "de": (("ungen", "ung"), ("innen", "in"), ("en", ""), ("er", ""), ("es", ""), ("em", ""), ("e", ""), ("n", ""), ("s", "")),
}


def stem(word, lang):
    """Crude stem so that plural / inflected forms meet: libraries -> library, Bibliotheken -> bibliothek.
    Only the first 7 letters count (Bibliothekar / Bibliothek meet too; that is fine for topics)."""
    w = word.casefold()
    for suf, rep_ in _SUFFIXES.get(lang, ()):
        if w.endswith(suf) and len(w) - len(suf) >= 4:
            w = w[: len(w) - len(suf)] + rep_
            if lang == "en" and suf in ("ing", "ed") and w[-1] == w[-2] and w[-1] in "bdgmnprt":
                w = w[:-1]                                   # stopped -> stop, planning -> plan, shopping -> shop
            break
    return w[:7]


class LatinFeatures:
    """segments = the content words (lower case, in order), bigrams = their stems (named like the Chinese
    features so the window / filter code is shared)."""
    __slots__ = ("text", "segments", "bigrams", "stems")

    def __init__(self, text, sw):
        self.text = text
        words = [w.casefold() for w in LATIN_WORD_RE.findall(text or "")]
        self.segments = [w for w in words if len(w) >= 3 and not sw.stops(w)]
        self.stems = [stem(w, sw.lang) for w in self.segments]
        self.bigrams = set(self.stems)


def features(text, sw, cfg=CONFIG):
    if isinstance(sw, LatinStop):
        return LatinFeatures(text, sw)
    return Features(text, sw, cfg["TIME_CUT"])


# ---------------------------------------------------------------------------------- window / cooldown
class Window:
    def __init__(self, texts, feats, df, generic, cooldown, topic_bigrams, latin=False):
        self.texts, self.feats, self.df = texts, feats, df
        self.generic, self.cooldown, self.topic_bigrams = generic, cooldown, topic_bigrams
        self.latin = latin


def analyze(recent, sw, cfg=CONFIG, topic=""):
    """recent: the last questions, NEWEST FIRST (strings).  topic: what the student asked for; its own words are
    never blocked (asking for "图书馆" must not be refused because 图书馆 was used yesterday)."""
    texts = [t for t in list(recent)[: cfg["WINDOW"]] if t and t.strip()]
    feats = [features(t, sw, cfg) for t in texts]
    n = len(feats)
    df = Counter(b for f in feats for b in f.bigrams)
    generic = set()
    if n >= cfg["GENERIC_MIN_DOCS"]:
        generic = {b for b, c in df.items() if c / n > cfg["GENERIC_RATIO"]}
    topic_bg = features(topic, sw, cfg).bigrams if topic and topic.strip() else set()
    cooldown = (set(df) - generic) - topic_bg
    return Window(texts, feats, df, generic, cooldown, topic_bg, isinstance(sw, LatinStop))


def _grow(b, segs, max_len):
    """Extend bigram b to the longest string (<= max_len) that ALL the given fragments still contain."""
    cand = b
    while len(cand) < max_len:
        grown = False
        s0 = segs[0]
        pos = s0.find(cand)
        while pos != -1 and not grown:
            for ext in ((s0[pos - 1] + cand) if pos > 0 else None,
                        (cand + s0[pos + len(cand)]) if pos + len(cand) < len(s0) else None):
                if ext and all(ext in s for s in segs):
                    cand, grown = ext, True
                    break
            pos = s0.find(cand, pos + 1) if not grown else pos
        if not grown:
            break
    return cand


def _fragment(b, segs, max_len):
    """Turn a bigram back into a readable content fragment: 图书 + 书馆 -> 图书馆."""
    if len(segs) == 1:
        seg = segs[0]
        if len(seg) <= max_len:
            return seg
        i = seg.find(b)
        start = max(0, min(i - (max_len - 2) // 2, len(seg) - max_len))
        return seg[start:start + max_len]
    return _grow(b, segs, max_len)


_LOCATIVE_TAIL = "里上中内外下前后边面旁"      # 咖啡店里, 实验室里 ...: only for the words shown to the model, never for matching


def _tidy(frag):
    while len(frag) > 2 and frag[-1] in _LOCATIVE_TAIL:
        frag = frag[:-1]
    return frag


def _head(seg, cooldown, max_len):
    """The readable start of a content fragment (fragments usually begin with the noun: 咖啡厅里写作业 -> 咖啡厅里).
    Starts at the first cooldown bigram so the word always carries a blocked feature."""
    if len(seg) <= max_len:
        return seg
    first = next((i for i in range(len(seg) - 1) if seg[i:i + 2] in cooldown), 0)
    start = max(0, min(first, len(seg) - max_len))
    return seg[start:start + max_len]


def hint_words_latin(win, cfg=CONFIG):
    """English / German: words recurring in several recent questions first, then the newest questions' words."""
    cap = cfg["MAX_HINT_WORDS"]
    occ = defaultdict(list)                                  # stem -> [(sentence index, word)]
    for idx, f in enumerate(win.feats):
        for w, st in zip(f.segments, f.stems):
            if st in win.cooldown:
                occ[st].append((idx, w))
    words, used = [], set()

    def push(st):
        if st in used or len(words) >= cap:
            return
        used.add(st)
        words.append(occ[st][0][1])                          # the form used in the newest question

    def n_sent(st):
        return len({i for i, _ in occ[st]})

    for st in sorted((st for st in occ if n_sent(st) >= 2), key=lambda st: (-n_sent(st), min(i for i, _ in occ[st]), st)):
        push(st)
    for f in win.feats:
        for st in f.stems:
            if st in occ:
                push(st)
    return words


def hint_words(win, cfg=CONFIG):
    """The topic words for the "avoid these" line.  First the words that recur in several recent questions
    (图书馆), then one fragment per remaining fragment of the newest questions."""
    if win.latin:
        return hint_words_latin(win, cfg)
    max_len, cap = cfg["HINT_MAX_LEN"], cfg["MAX_HINT_WORDS"]
    occ = defaultdict(list)                                  # bigram -> [(sentence index, fragment)]
    for idx, f in enumerate(win.feats):
        for seg in f.segments:
            for b in bigrams_of(seg):
                if b in win.cooldown:
                    occ[b].append((idx, seg))
    words, covered = [], set()

    def push(frag):
        if len(frag) < 2 or any(frag in w or w in frag for w in words):
            return False
        words.append(frag)
        return True

    def n_sent(b):
        return len({i for i, _ in occ[b]})

    for b in sorted((b for b in occ if n_sent(b) >= 2), key=lambda b: (-n_sent(b), min(i for i, _ in occ[b]), b)):
        if len(words) >= cap:
            break
        frag = _tidy(_grow(b, list(dict.fromkeys(s for _, s in occ[b])), max_len))
        if push(frag):
            covered |= {(i, s) for i, s in occ[b] if frag in s}
    for idx, f in enumerate(win.feats):
        for seg in f.segments:
            if len(words) >= cap:
                return words
            if (idx, seg) not in covered and bigrams_of(seg) & win.cooldown:
                push(_tidy(_head(seg, win.cooldown, max_len)))
    return words


def _readable(hit_bigrams, segs, cfg=CONFIG, feats=None):
    """Hits of a candidate sentence as content fragments (for the log and the retry hint)."""
    if isinstance(feats, LatinFeatures):
        return list(dict.fromkeys(w for w, st in zip(feats.segments, feats.stems) if st in hit_bigrams))
    words = []
    for b in sorted(hit_bigrams):
        own = [s for s in segs if b in s] or [b]
        frag = _tidy(_fragment(b, own[:1], cfg["HINT_MAX_LEN"]))
        if not any(frag in w or w in frag for w in words):
            words.append(frag)
    return words


def cooldown_report(recent, sw, cfg=CONFIG, topic=""):
    win = analyze(recent, sw, cfg, topic)
    return {
        "words": hint_words(win, cfg),
        "window": len(win.texts),
        "generic_active": len(win.texts) >= cfg["GENERIC_MIN_DOCS"],
        "generic": sorted(win.generic),
        "cooldown_size": len(win.cooldown),
    }


# ---------------------------------------------------------------------------------- filter
def filter_candidates(cands, recent, sw, cfg=CONFIG, context=(), topic="", force_if_empty=False):
    """cands: strings or dicts with a "zh" key (other keys pass through).  recent: newest-first questions from the
    database.  context: sentences already accepted in this batch (earlier round).
    Returns {"kept": [...], "dropped": [{..., "hits": [bigrams], "hit_words": [fragments]}], "forced": bool}."""
    win = analyze(recent, sw, cfg, topic)
    blocked = set(win.cooldown)
    skip = win.generic | win.topic_bigrams
    if cfg["INTRA_BATCH"]:
        for t in context:
            blocked |= features(t, sw, cfg).bigrams - skip
    kept, dropped = [], []
    for c in cands:
        item = dict(c) if isinstance(c, dict) else {"zh": c}
        zh = item.get("zh")
        zh = zh.strip() if isinstance(zh, str) else ""
        if not zh:
            continue
        item["zh"] = zh
        f = features(zh, sw, cfg)
        hits = sorted(f.bigrams & blocked)
        if len(hits) >= cfg["MIN_SHARED"]:
            dropped.append({**item, "hits": hits, "hit_words": _readable(hits, f.segments, cfg, f)})
        else:
            kept.append(item)
            if cfg["INTRA_BATCH"]:
                blocked |= f.bigrams - skip
    forced = False
    if force_if_empty and not kept and not list(context) and dropped:
        best = min(dropped, key=lambda d: len(d["hits"]))             # fewest hits; ties: the first one
        dropped.remove(best)
        kept.append({k: v for k, v in best.items() if k not in ("hits", "hit_words")})
        forced = True
    return {"kept": kept, "dropped": dropped, "forced": forced}


# ---------------------------------------------------------------------------------- grammar points
def rank_foci(last_used, k, foci=GRAMMAR_FOCI, rng=random, weak=()):
    """last_used: {focus: id of the newest question that used it}.  Never used first, then the longest ago; ties random.
    weak: grammar points to put in front (already limited and ordered by weak_foci)."""
    order = list(foci)
    rng.shuffle(order)
    order.sort(key=lambda f: last_used.get(f, 0))                    # stable: ties keep the shuffled order
    front = [f for f in weak if f in order]
    return (front + [f for f in order if f not in front])[: max(0, k)]


def weak_foci(answers, recent_foci, cfg=CONFIG):
    """answers: [(focus, wrong: bool)] NEWEST FIRST (translations whose exercise had a grammar point).
    recent_foci: grammar points of the newest exercises, newest first.
    Returns up to WEAK_SLOTS points with an error share >= WEAK_RATIO in their last WEAK_WINDOW answers,
    worst first, skipping the ones used in the last WEAK_COOLDOWN exercises."""
    per = defaultdict(list)
    for focus, wrong in answers:
        if focus and len(per[focus]) < cfg["WEAK_WINDOW"]:
            per[focus].append(bool(wrong))
    resting = set(list(recent_foci)[: cfg["WEAK_COOLDOWN"]])
    scored = [(sum(v) / len(v), sum(v), f) for f, v in per.items() if v and f not in resting and sum(v) / len(v) >= cfg["WEAK_RATIO"]]
    scored.sort(key=lambda x: (-x[0], -x[1], x[2]))
    return [f for _, _, f in scored[: cfg["WEAK_SLOTS"]]]


# ---------------------------------------------------------------------------------- log
def append_log(data_dir, record):
    """One JSON line per event in topic_filter.log; never raises (logging must not break the app)."""
    try:
        rec = {"ts": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"), **record}
        with open(os.path.join(data_dir, LOG_FILE), "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except OSError:
        pass
