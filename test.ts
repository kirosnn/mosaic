// Ce fichier contient du contenu aléatoire pour des tests

// Fonction pour générer un nombre aléatoire
function genererNombreAleatoire(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Exemple d'utilisation
const nombreAleatoire = genererNombreAleatoire(1, 100);
console.log(`Nombre aléatoire généré : ${nombreAleatoire}`);

// Tableau de chaînes de caractères aléatoires
const motsAleatoires = ["Mosaic", "Test", "Développement", "Aléatoire", "TypeScript"];

// Affichage d'un mot aléatoire
const motAleatoire = motsAleatoires[Math.floor(Math.random() * motsAleatoires.length)];
console.log(`Mot aléatoire : ${motAleatoire}`);