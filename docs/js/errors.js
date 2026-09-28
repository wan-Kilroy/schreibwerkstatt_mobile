/* Error types (v0.4): the model tags every correction with a few of these keys; the statistics count them.
 * The keys are shared between languages where the idea is the same (article, word_order …), so a key's name
 * is the same whatever language is learned. */
import { ui } from './i18n.js';

/* which keys the model may use, per language learned, with a short English gloss for the prompt */
export const ERR_TAGS = {
  de: { spelling: 'spelling', capital: 'capitalization', article: 'articles', gender: 'noun gender', case: 'case (Kasus)',
    ending: 'adjective / noun endings', verb: 'conjugation / verb form', tense: 'tense', word_order: 'word order (verb position …)',
    preposition: 'prepositions', punctuation: 'obligatory commas', word_choice: 'wrong word / collocation', missing: 'missing or extra word' },
  en: { spelling: 'spelling', article: 'articles', tense: 'tense and aspect', agreement: 'subject-verb agreement', verb: 'verb form',
    plural: 'plural forms', countable: 'countable / uncountable nouns', word_order: 'word order', preposition: 'prepositions',
    word_choice: 'wrong word / collocation', missing: 'missing or extra word' },
  zh: { character: 'wrong characters', measure: 'measure words', word_order: 'word order', aspect: 'aspect particles 了/过/着',
    particle: 'structural particles 的/得/地', complement: 'complements', word_choice: 'wrong word / collocation', missing: 'missing or extra word' },
  fr: { spelling: 'spelling and accents', article: 'articles', gender: 'noun gender', agreement: 'agreement (adjectives, participles)',
    verb: 'conjugation', tense: 'tense and mood', auxiliary: 'auxiliary être / avoir', pronoun: 'pronouns and their place',
    word_order: 'word order', preposition: 'prepositions', word_choice: 'wrong word / collocation', missing: 'missing or extra word' },
};
export const errKeys = learn => Object.keys(ERR_TAGS[learn] || {});
/* for the prompt: "article = articles, case = case (Kasus), …" */
export const errGloss = learn => Object.entries(ERR_TAGS[learn] || {}).map(([k, g]) => `${k} = ${g}`).join('; ');

/* names shown to the student, per interface language; "meaning" is added by the page when a translation says something else */
const LABELS = {
  zh: { spelling: '拼写', capital: '大小写', article: '冠词', gender: '名词的性', case: '格', ending: '词尾变化', verb: '动词变位 / 形式',
    tense: '时态', agreement: '一致（主谓 / 性数）', plural: '单复数', countable: '可数 / 不可数', word_order: '语序', preposition: '介词',
    punctuation: '标点', word_choice: '用词 / 搭配', missing: '缺词 / 多词', character: '错别字', measure: '量词', aspect: '了 / 过 / 着',
    particle: '的 / 得 / 地', complement: '补语', auxiliary: '助动词 être / avoir', pronoun: '代词', meaning: '意思偏了', gave_up: '不会' },
  en: { spelling: 'Spelling', capital: 'Capitalisation', article: 'Articles', gender: 'Noun gender', case: 'Case', ending: 'Endings',
    verb: 'Verb forms', tense: 'Tense', agreement: 'Agreement', plural: 'Plural', countable: 'Countable nouns', word_order: 'Word order',
    preposition: 'Prepositions', punctuation: 'Punctuation', word_choice: 'Word choice', missing: 'Missing / extra words',
    character: 'Wrong characters', measure: 'Measure words', aspect: '了 / 过 / 着', particle: '的 / 得 / 地', complement: 'Complements',
    auxiliary: 'Auxiliary être / avoir', pronoun: 'Pronouns', meaning: 'Meaning', gave_up: 'Didn’t know' },
  de: { spelling: 'Rechtschreibung', capital: 'Groß-/Kleinschreibung', article: 'Artikel', gender: 'Genus', case: 'Kasus', ending: 'Endungen',
    verb: 'Verbformen', tense: 'Zeitform', agreement: 'Kongruenz', plural: 'Plural', countable: 'Zählbarkeit', word_order: 'Wortstellung',
    preposition: 'Präpositionen', punctuation: 'Zeichensetzung', word_choice: 'Wortwahl', missing: 'Fehlende / überflüssige Wörter',
    character: 'Falsche Schriftzeichen', measure: 'Zählwörter', aspect: '了 / 过 / 着', particle: '的 / 得 / 地', complement: 'Komplemente',
    auxiliary: 'Hilfsverb être / avoir', pronoun: 'Pronomen', meaning: 'Bedeutung', gave_up: 'Nicht gewusst' },
};
export const errLabel = k => (LABELS[ui()] || LABELS.en)[k] || k;

/* what the model returned -> clean list of known keys (at most 4), "meaning" first when the translation missed the point */
export function cleanErrors(v, learn, { isCorrect, meaning }) {
  const known = new Set(errKeys(learn));
  const out = isCorrect ? [] : [...new Set((Array.isArray(v) ? v : []).map(x => String(x).trim().toLowerCase()).filter(x => known.has(x)))].slice(0, 4);
  if (meaning === 'off') out.unshift('meaning');
  return out;
}
