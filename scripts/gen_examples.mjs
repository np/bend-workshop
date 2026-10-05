// Builds the examples list: the guide's runnable blocks, a few of the repo's
// demos (Apache-2.0, HigherOrderCO), and one program written for this page.
import fs from "node:fs";
const R = "../bend";
const md = fs.readFileSync(R + "/guide/GUIDE.md", "utf8");
const blocks = [...md.matchAll(/```python\n([\s\S]*?)```/g)].map((m) => m[1]);
const pick = (needle) => {
  const b = blocks.find((x) => x.includes(needle));
  if (!b) throw new Error("no guide block with " + needle);
  return b;
};
const read = (p) => fs.readFileSync(R + "/" + p, "utf8");
const one = (text) => [{ name: "main.bend", text }];
const demo = (d, names) => names.map((n) => ({ name: n, text: read("demos/" + d + "/" + n) }));

const mods = pick("# math.bend");
const math = mods.replace(/^# math\.bend\n/, "");
const main2 = pick("import ./math.bend as M").replace(/^# main\.bend\n/, "");

const L = (en, fr, pt) => ({ en, fr, pt });
const G = { start: L("First steps", "Premiers pas", "Primeiros passos"), types: L("Resources and types", "Ressources et types", "Recursos e tipos"),
  effects: L("Effects", "Effets", "Efeitos"), windows: L("Windows", "Fenêtres", "Janelas"), laws: L("Laws and proofs", "Lois et preuves", "Leis e provas"),
  files: L("Several files", "Plusieurs fichiers", "Vários arquivos") };
const out = [
  { group: G.start, title: L("Hello, world", "Hello, world", "Hello, world"), note: L("A main in IO", "Un main dans IO", "Um main em IO"), files: one(pick('IO.print("Hello, world!")')) },
  { group: G.start, title: L("FizzBuzz", "FizzBuzz", "FizzBuzz"), note: L("A loop bounded by a Nat, a match on two Bools", "Boucle bornée par un Nat, match sur deux Bool", "Um laço limitado por um Nat, um match sobre dois Bool"), files: one(fs.readFileSync("ex/fizz/main.bend", "utf8")) },
  { group: G.start, title: L("Types and functions", "Types et fonctions", "Tipos e funções"), note: L("A datatype and a match", "Un type de données et un match", "Um tipo de dados e um match"), files: one(pick("type Shape is Data")) },
  { group: G.start, title: L("Closures", "Fermetures", "Closures"), note: L("Functions are affine values", "Les fonctions sont des valeurs affines", "Funções são valores afins"), files: one(pick("def adder(")) },
  { group: G.start, title: L("Recursion", "Récursion", "Recursão"), note: L("Termination checked, tail calls as loops", "Terminaison vérifiée, appels terminaux en boucle", "Terminação verificada, chamadas de cauda como laços"), files: one(pick("def sum(xs: List<U32>")) },
  { group: G.start, title: L("The Base library", "La bibliothèque Base", "A biblioteca Base"), note: L("Type.verb: show, to_nat, operators", "Type.verbe : show, to_nat, opérateurs", "Tipo.verbo: show, to_nat, operadores"), files: one(pick("U32.show(a) ++")) },

  { group: G.types, title: L("Quantities", "Quantités", "Quantidades"), note: L("Erased (-), affine, reusable (+)", "Effacé (-), affine, réutilisable (+)", "Apagado (-), afim, reutilizável (+)"), files: one(pick("def replicate(")) },
  { group: G.types, title: L("Kinds", "Kinds", "Kinds"), note: L("Polymorphism over the quantity", "Polymorphisme sur la quantité", "Polimorfismo sobre a quantidade"), files: one(pick("def length(a, -A: Kind(a)")) },
  { group: G.types, title: L("Templates", "Templates", "Templates"), note: L("Arguments substituted at compile time (~)", "Arguments substitués à la compilation (~)", "Argumentos substituídos em tempo de compilação (~)"), files: one(pick("def twice(~f")) },
  { group: G.types, title: L("Arrays", "Tableaux", "Arrays"), note: L("In-place mutation without losing purity", "Mutation en place, sans perdre la pureté", "Mutação no lugar sem perder a pureza"), files: one(pick("a[5] <- 42")) },
  { group: G.types, title: L("Monads", "Monades", "Mônadas"), note: L("The do notation with Maybe", "La notation do avec Maybe", "A notação do com Maybe"), files: one(pick("def add_strs(")) },

  { group: G.effects, title: L("IO and concurrency", "IO et concurrence", "IO e concorrência"), note: L("sleep, fork, join on an event loop", "sleep, fork, join sur une boucle d'événements", "sleep, fork, join num laço de eventos"), files: one(pick("def greet(name")) },
  { group: G.effects, title: L("Parallel calls", "Appels parallèles", "Chamadas paralelas"), note: L("pow2 with fork/join (sequential in JS)", "pow2 en fork/join (séquentiel en JS)", "pow2 com fork/join (sequencial em JS)"), files: one(pick("# parallel call")) },
  { group: G.effects, title: L("A foreign effect in JavaScript", "Effet étranger en JavaScript", "Um efeito externo em JavaScript"), note: L("A def whose body is a .js file of the workspace", "Un def dont le corps est un fichier .js de l'espace de travail", "Um def cujo corpo é um arquivo .js do espaço de trabalho"),
    files: [{ name: "main.bend", text: fs.readFileSync("ex/eff/main.bend", "utf8") }, { name: "clock.js", text: fs.readFileSync("ex/eff/clock.js", "utf8") }] },

  { group: G.windows, title: L("A window, a state", "Une fenêtre, un état", "Uma janela, um estado"), note: L("App.run: view draws a quadtree, tick reads the events", "App.run : view dessine un quadtree, tick lit les événements", "App.run: view desenha uma quadtree, tick lê os eventos"),
    files: one(pick("App.run(")) },
  { group: G.windows, title: L("Triangle", "Triangle", "Triângulo"), note: L("A click subdivides, Escape quits", "Cliquer subdivise, Échap quitte", "Um clique subdivide, Esc sai"),
    files: demo("app_triangle_2d", ["main.bend", "LAWS.bend", "PROOF.bend"]) },
  { group: G.windows, title: L("Pong", "Pong", "Pong"), note: L("W and S on the left, arrows on the right, at 60 frames per second", "W et S à gauche, flèches à droite, à 60 images par seconde", "W e S à esquerda, setas à direita, a 60 quadros por segundo"),
    files: demo("app_pong_game_2d", ["main.bend", "LAWS.bend", "PROOF.bend"]) },
  { group: G.windows, title: L("Ray tracer", "Lancer de rayons", "Ray tracer"), note: L("Slow in JavaScript: seconds per frame", "Lent en JavaScript : plusieurs secondes par image", "Lento em JavaScript: segundos por quadro"),
    files: demo("app_ray_tracer_3d", ["main.bend", "LAWS.bend", "PROOF.bend"]) },

  { group: G.laws, title: L("The bounty: a falsehood", "Le bounty : une fausseté", "O bounty: uma falsidade"), note: L("$10k for a proof of Empty that --verdict accepts; the setup, with its TODO", "10 k$ pour une preuve de Empty que --verdict accepte ; la mise en place, avec son TODO", "US$ 10 mil por uma prova de Empty que o --verdict aceite; a preparação, com o seu TODO"),
    files: [{ name: "bounty.bend", text: fs.readFileSync("ex/bounty/bounty.bend", "utf8") }] },
  { group: G.laws, title: L("x + 0 = x", "x + 0 = x", "x + 0 = x"), note: L("A law, and its proof by induction", "Une loi, et sa preuve par induction", "Uma lei, e a sua prova por indução"), files: one(pick("law add_zero")) },
  { group: G.laws, title: L("Parallel sum, proved", "Somme parallèle prouvée", "Soma paralela, provada"), note: L("main, LAWS and PROOF: open PROOF.bend, then check", "main, LAWS et PROOF : ouvrir PROOF.bend puis vérifier", "main, LAWS e PROOF: abra PROOF.bend e verifique"),
    files: demo("pure_par_sum", ["main.bend", "LAWS.bend", "PROOF.bend"]) },
  { group: G.laws, title: L("Insertion sort, proved", "Tri par insertion prouvé", "Ordenação por inserção, provada"), note: L("Sorted, and a permutation of the input", "Trié, et permutation de l'entrée", "Ordenada, e uma permutação da entrada"),
    files: demo("proof_insertion_sort", ["main.bend", "LAWS.bend", "PROOF.bend"]) },
  { group: G.laws, title: L("Typed evaluator", "Évaluateur typé", "Avaliador tipado"), note: L("An expression language well typed by construction", "Un langage d'expressions bien typé par construction", "Uma linguagem de expressões bem tipada por construção"),
    files: demo("proof_typed_eval", ["main.bend", "LAWS.bend", "PROOF.bend"]) },

  { group: G.files, title: L("Modules", "Modules", "Módulos"), note: L("import ./math.bend as M", "import ./math.bend as M", "import ./math.bend as M"), files: [{ name: "main.bend", text: main2 }, { name: "math.bend", text: math }] },
];
out.forEach((e, i) => { e.id = "ex" + i; });
fs.writeFileSync("gen/examples.json", JSON.stringify(out));
console.log(out.length, "examples,", JSON.stringify(out).length, "bytes");
