import { describe, expect, it } from "vitest";
import { acceptsHit, fold, type Hit, type SongRef } from "../../src/core/searchMatch";

const song = (title: string, primary: string[], featured: string[] = []): SongRef => ({ title, primary, featured });
const hit = (title: string, ...artists: string[]): Hit => ({ title, artists, album: "x" });
const both = (s: SongRef, h: Hit, want: boolean, note: string): void => {
  expect(acceptsHit("spotify", s, h), `${note} (spotify)`).toBe(want);
  expect(acceptsHit("apple", s, h), `${note} (apple)`).toBe(want);
};

describe("scripts other than Latin", () => {
  it("matches the same Cyrillic, Greek, Arabic, Hebrew, Hindi, Thai, Chinese, Japanese and Korean text", () => {
    both(song("Группа крови", ["Кино"]), hit("Группа крови", "Кино"), true, "cyrillic");
    both(song("Ой у лузі", ["Тартак"]), hit("Ой у лузі", "Тартак"), true, "ukrainian");
    both(song("Αγάπη", ["Νότης Σφακιανάκης"]), hit("Αγαπη", "Νότης Σφακιανάκης"), true, "greek, accent dropped");
    both(song("حبيبي", ["عمرو دياب"]), hit("حبيبي", "عمرو دياب"), true, "arabic");
    both(song("حَبِيبِي", ["عمرو دياب"]), hit("حبيبي", "عمرو دياب"), true, "arabic with vowel marks");
    both(song("שָׁלוֹם", ["עומר אדם"]), hit("שלום", "עומר אדם"), true, "hebrew with niqqud");
    both(song("तेरा", ["अरिजीत सिंह"]), hit("तेरा", "अरिजीत सिंह"), true, "hindi");
    both(song("เธอ", ["ธนาธร"]), hit("เธอ", "ธนาธร"), true, "thai");
    both(song("晴天", ["周杰倫"]), hit("晴天", "周杰倫"), true, "chinese");
    both(song("봄날", ["방탄소년단"]), hit("봄날", "방탄소년단"), true, "korean");
    both(song("ｶﾀｶﾅ", ["A"]), hit("カタカナ", "A"), true, "half-width kana");
  });
  it("keeps marks that change the word apart", () => {
    both(song("कि", ["A"]), hit("क", "A"), false, "hindi vowel sign");
    both(song("ที่", ["A"]), hit("ท", "A"), false, "thai vowel sign");
    both(song("かた", ["A"]), hit("がた", "A"), false, "kana voicing mark");
    expect(fold("ガ")).not.toBe(fold("カ"));
  });
  it("reads composed and decomposed accents the same", () => {
    both(song("Beyoncé", ["Beyoncé"]), hit("Beyoncé", "Beyoncé"), true, "nfd");
  });
  it("matches letters a Latin keyboard spells another way", () => {
    both(song("Final Song", ["MØ"]), hit("Final Song", "MO"), true, "o with stroke");
    both(song("Łódź", ["Łona"]), hit("Lodz", "Lona"), true, "l with stroke");
    both(song("Straße", ["A"]), hit("Strasse", "A"), true, "sharp s");
    both(song("Işık", ["Ajda Pekkan"]), hit("Isik", "Ajda Pekkan"), true, "dotless i");
  });
});

describe("names and titles made only of symbols", () => {
  it("is never read as the same as another symbol-only text", () => {
    both(song("♥", ["A"]), hit("★", "A"), false, "symbol titles");
    both(song("🔥", ["A"]), hit("💧", "A"), false, "emoji titles");
    both(song("Song", ["!!!"]), hit("Song", "???"), false, "symbol artists");
  });
  it("matches the same symbols", () => {
    both(song("♥", ["A"]), hit("♥", "A"), true, "same symbol title");
    both(song("Song", ["!!!"]), hit("Song", "!!!"), true, "same symbol artist");
  });
});

describe("Genius names as they are written for Russian and Ukrainian songs", () => {
  const korzh = song("Жить в кайф (Live Dope)", ["Макс Корж (Max Korzh)"]);
  it("matches the native spelling, the Latin one or the whole name", () => {
    both(korzh, hit("Жить в кайф", "Макс Корж"), true, "native");
    both(korzh, hit("Live Dope", "Max Korzh"), true, "latin");
    both(korzh, hit("Жить в кайф (Live Dope)", "Макс Корж (Max Korzh)"), true, "whole");
  });
  it("rejects another song or another artist", () => {
    both(korzh, hit("Жить в кайф", "Макс Иванов"), false, "other artist");
    both(korzh, hit("Малый повзрослел", "Макс Корж"), false, "other song");
  });
  it("reads a name with two brackets in a row under each shorter spelling", () => {
    const samsara = song("Сансара (Samsara)", ["Баста (Basta)"], ["Ант (Ant) (RUS)"]);
    expect(acceptsHit("spotify", samsara, hit("Сансара", "Баста", "Ант"))).toBe(true);
    expect(acceptsHit("spotify", samsara, hit("Samsara", "Basta", "Ant"))).toBe(true);
    expect(acceptsHit("spotify", samsara, hit("Сансара", "Баста", "Ант Иванов"))).toBe(false);
  });
  it("does not take a Genius translation page for the original song", () => {
    const translation = song("Жить в кайф (Live Dope) (English Translation)", ["Genius English Translations"]);
    both(translation, hit("Жить в кайф", "Макс Корж"), false, "translation page");
  });
});

describe("everyday title and artist shapes", () => {
  it("ignores edition words but keeps version words", () => {
    both(song("Song", ["A"]), hit("Song - 2011 Remaster", "A"), true, "remaster");
    both(song("Song (Remastered 2009)", ["A"]), hit("Song", "A"), true, "remastered on Genius");
    both(song("Song", ["A"]), hit("Song (Remix)", "A"), false, "remix");
    both(song("Song", ["A"]), hit("Song - Live", "A"), false, "live");
    both(song("Song", ["A"]), hit("Song (Sped Up)", "A"), false, "sped up");
  });
  it("reads punctuation the way both sides write it", () => {
    both(song("Song (Taylor's Version)", ["T"]), hit("Song (Taylor’s Version)", "T"), true, "apostrophe");
    both(song("Song – Part 2", ["A"]), hit("Song - Part 2", "A"), true, "dash");
    both(song("Rock & Roll", ["A"]), hit("Rock and Roll", "A"), true, "ampersand");
    both(song("Don't Stop", ["Guns N' Roses"]), hit("Dont Stop", "Guns N’ Roses"), true, "apostrophe in artist");
    both(song("s", ["a$ap rocky"]), hit("S", "A$AP Rocky"), true, "case");
    both(song("1999", ["Prince"]), hit("1999", "Prince"), true, "digits");
    both(song("1999", ["Prince"]), hit("2000", "Prince"), false, "other digits");
  });
  it("needs every artist and no other", () => {
    const three = song("S", ["A", "B", "C"]);
    expect(acceptsHit("spotify", three, hit("S", "A", "B", "C"))).toBe(true);
    expect(acceptsHit("apple", three, hit("S", "A, B & C"))).toBe(true);
    expect(acceptsHit("apple", three, hit("S", "A & B"))).toBe(false);
    both(song("S", ["Wayne"]), hit("S", "Lil Wayne"), false, "name inside another name");
  });
  it("reads featured artists where each service puts them", () => {
    const feat = song("S", ["A"], ["B", "C"]);
    expect(acceptsHit("spotify", feat, hit("S", "A", "B", "C"))).toBe(true);
    expect(acceptsHit("apple", feat, hit("S (feat. B & C)", "A"))).toBe(true);
    expect(acceptsHit("apple", feat, hit("S (feat. B)", "A"))).toBe(false);
  });
});

// One real-looking song per widely spoken language. `genius` is how Genius writes it, `service` how a service lists
// it; every pair must match on both services, and the same song by another artist must not.
const LANGUAGES: [string, [string, string], [string, string]][] = [
  ["spanish", ["Tití Me Preguntó", "Bad Bunny"], ["Titi Me Pregunto", "Bad Bunny"]],
  ["portuguese", ["Evidências", "Chitãozinho & Xororó"], ["Evidencias", "Chitãozinho & Xororó"]],
  ["french", ["Papaoutai", "Stromae"], ["Papaoutai", "Stromae"]],
  ["french accents", ["Déjà vu", "Céline Dion"], ["Deja vu", "Celine Dion"]],
  ["german", ["Über den Wolken", "Reinhard Mey"], ["Uber den Wolken", "Reinhard Mey"]],
  ["italian", ["Così è la vita", "Måneskin"], ["Cosi e la vita", "Maneskin"]],
  ["dutch", ["Ik ben een ĳsbeer", "Marco Borsato"], ["Ik ben een ijsbeer", "Marco Borsato"]],
  ["swedish", ["Köp mig", "Zara Larsson"], ["Kop mig", "Zara Larsson"]],
  ["danish", ["På vej", "Åse"], ["Pa vej", "Ase"]],
  ["norwegian", ["Sølvstjerne", "Ærlig"], ["Solvstjerne", "Aerlig"]],
  ["icelandic", ["Þín", "Sigur Rós"], ["thin", "Sigur Ros"]],
  ["polish", ["Żółć", "Łukasz Żółtek"], ["Zolc", "Lukasz Zoltek"]],
  ["czech", ["Příliš žluťoučký", "Čechomor"], ["Prilis zlutoucky", "Cechomor"]],
  ["hungarian", ["Őszi szél", "Ünnepi Ő"], ["Oszi szel", "Unnepi O"]],
  ["romanian", ["Șoapte", "Ștefan Țicu"], ["Soapte", "Stefan Ticu"]],
  ["turkish", ["Şımarık", "Tarkan"], ["Simarik", "Tarkan"]],
  ["vietnamese", ["Nơi này có anh", "Sơn Tùng M-TP"], ["Noi nay co anh", "Son Tung M-TP"]],
  ["indonesian", ["Lathi", "Weird Genius"], ["Lathi", "Weird Genius"]],
  ["greek", ["Σ' αγαπώ", "Έλενα Παπαρίζου"], ["Σ αγαπω", "Ελενα Παπαριζου"]],
  ["bulgarian", ["Ела", "Азис"], ["Ела", "Азис"]],
  ["serbian", ["Ђе си", "Цеца"], ["Ђе си", "Цеца"]],
  ["russian", ["Ёлка", "Ёлка"], ["Елка", "Елка"]],
  ["ukrainian", ["Їжак", "Бумбокс"], ["Їжак", "Бумбокс"]],
  ["arabic", ["حبيبي يا نور العين", "عمرو دياب"], ["حَبِيبِي يَا نُورَ الْعَيْنِ", "عمرو دياب"]],
  ["arabic hamza", ["أحبك", "إليسا"], ["احبك", "اليسا"]],
  ["persian", ["دلتنگی", "محسن چاوشی"], ["دلتنگي", "محسن چاوشي"]],
  ["hebrew", ["שלום עליכם", "עומר אדם"], ["שָׁלוֹם עֲלֵיכֶם", "עומר אדם"]],
  ["hindi", ["तुम हो", "अरिजीत सिंह"], ["तुम हो", "अरिजीत सिंह"]],
  ["bengali", ["আমার সোনার বাংলা", "রবীন্দ্রনাথ"], ["আমার সোনার বাংলা", "রবীন্দ্রনাথ"]],
  ["tamil", ["என்னை கொஞ்சம்", "ஏ. ஆர். ரகுமான்"], ["என்னை கொஞ்சம்", "ஏ. ஆர். ரகுமான்"]],
  ["telugu", ["బుట్ట బొమ్మ", "అర్మాన్ మాలిక్"], ["బుట్ట బొమ్మ", "అర్మాన్ మాలిక్"]],
  ["urdu", ["پسوڑی", "علی سیٹھی"], ["پسوڑی", "علی سیٹھی"]],
  ["thai", ["เธอ", "ธนาธร"], ["เธอ", "ธนาธร"]],
  ["lao", ["ຄິດຮອດ", "ນັກຮ້ອງ"], ["ຄິດຮອດ", "ນັກຮ້ອງ"]],
  ["khmer", ["ស្រលាញ់", "សិន ស៊ីសាមុត"], ["ស្រលាញ់", "សិន ស៊ីសាមុត"]],
  ["georgian", ["ვაშლი", "ნინო"], ["ვაშლი", "ნინო"]],
  ["armenian", ["Սեր", "Արամ"], ["Սեր", "Արամ"]],
  ["chinese simplified", ["告白气球", "周杰伦"], ["告白气球", "周杰伦"]],
  ["chinese traditional", ["晴天", "周杰倫"], ["晴天", "周杰倫"]],
  ["japanese", ["夜に駆ける", "YOASOBI"], ["夜に駆ける", "YOASOBI"]],
  ["japanese katakana", ["ダイナマイト", "ガガ"], ["ﾀﾞｲﾅﾏｲﾄ", "ガガ"]],
  ["korean", ["봄날", "방탄소년단"], ["봄날", "방탄소년단"]],
];
describe("one song in each widely spoken language", () => {
  for (const [language, genius, service] of LANGUAGES) {
    it(language, () => {
      const s = song(genius[0], [genius[1]]);
      both(s, hit(service[0], service[1]), true, `${language} same song`);
      both(s, hit(service[0], `${service[1]} Other`), false, `${language} other artist`);
      both(s, hit(`${service[0]} Other`, service[1]), false, `${language} other title`);
    });
  }
});

describe("a Genius name written as native plus Latin, in every script", () => {
  const PAIRS: [string, string, string, string][] = [
    ["korean", "봄날 (Spring Day)", "방탄소년단 (BTS)", "Spring Day|BTS"],
    ["chinese", "晴天 (Sunny Day)", "周杰倫 (Jay Chou)", "晴天|周杰倫"],
    ["arabic", "حبيبي (Habibi)", "عمرو دياب (Amr Diab)", "Habibi|Amr Diab"],
    ["hindi", "तुम हो (Tum Ho)", "अरिजीत सिंह (Arijit Singh)", "तुम हो|Arijit Singh"],
    ["thai", "เธอ (Thoe)", "ธนาธร (Thanathorn)", "Thoe|ธนาธร"],
    ["greek", "Αγάπη (Agapi)", "Έλενα (Elena)", "Agapi|Elena"],
    ["hebrew", "שלום (Shalom)", "עומר אדם (Omer Adam)", "שלום|Omer Adam"],
    ["japanese", "夜に駆ける (Yoru ni Kakeru)", "ヨアソビ (YOASOBI)", "夜に駆ける|YOASOBI"],
    ["latin first", "Idol (アイドル)", "YOASOBI (ヨアソビ)", "アイドル|YOASOBI"],
  ];
  for (const [name, title, artist, served] of PAIRS) {
    it(name, () => {
      const [t, a] = served.split("|") as [string, string];
      both(song(title, [artist]), hit(t, a), true, `${name} as served`);
      both(song(title, [artist]), hit(t, `${a} Other`), false, `${name} other artist`);
    });
  }
});
