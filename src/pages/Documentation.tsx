import { useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  X,
  Minus,
  BookOpen,
  Home,
  Layers,
  User,
  Palette,
  Download,
  Cloud,
  Share2,
  Settings,
  ChevronRight,
  Search,
} from "lucide-react";
import { useTranslation } from "@/i18n";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

type Section =
  | "home"
  | "instances"
  | "accounts"
  | "skins"
  | "browse"
  | "backups"
  | "sharing"
  | "settings";

const sections = [
  { id: "home" as Section, icon: Home, label: "Accueil" },
  { id: "instances" as Section, icon: Layers, label: "Instances" },
  { id: "accounts" as Section, icon: User, label: "Comptes" },
  { id: "skins" as Section, icon: Palette, label: "Skins" },
  { id: "browse" as Section, icon: Download, label: "Parcourir (Modrinth)" },
  { id: "backups" as Section, icon: Cloud, label: "Sauvegardes" },
  { id: "sharing" as Section, icon: Share2, label: "Partage" },
  { id: "settings" as Section, icon: Settings, label: "Parametres" },
];

export default function Documentation() {
  const { t } = useTranslation();
  const [activeSection, setActiveSection] = useState<Section>("home");
  const [searchQuery, setSearchQuery] = useState("");

  const handleClose = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const window = getCurrentWindow();
      await window.close();
    } catch (error) {
      console.error("Failed to close window:", error);
    }
  };

  const handleMinimize = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const window = getCurrentWindow();
      await window.minimize();
    } catch (error) {
      console.error("Failed to minimize window:", error);
    }
  };

  const handleDragStart = async (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    try {
      const window = getCurrentWindow();
      await window.startDragging();
    } catch (error) {
      console.error("Failed to start dragging:", error);
    }
  };

  const renderContent = () => {
    switch (activeSection) {
      case "home":
        return <HomeSection />;
      case "instances":
        return <InstancesSection />;
      case "accounts":
        return <AccountsSection />;
      case "skins":
        return <SkinsSection />;
      case "browse":
        return <BrowseSection />;
      case "backups":
        return <BackupsSection />;
      case "sharing":
        return <SharingSection />;
      case "settings":
        return <SettingsSection />;
      default:
        return <HomeSection />;
    }
  };

  const filteredSections = sections.filter((s) =>
    s.label.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Custom title bar */}
      <div
        className="flex items-center justify-between h-10 px-3 bg-muted/50 border-b select-none shrink-0 cursor-move"
        onMouseDown={handleDragStart}
      >
        <div className="flex items-center gap-2 pointer-events-none">
          <BookOpen className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">{t("documentation.title")}</span>
        </div>
        <div className="flex items-center gap-1 pointer-events-auto">
          <button
            onClick={handleMinimize}
            onMouseDown={(e) => e.stopPropagation()}
            className="p-1.5 rounded hover:bg-muted transition-colors"
            title="Minimize"
          >
            <Minus className="h-4 w-4 pointer-events-none" />
          </button>
          <button
            onClick={handleClose}
            onMouseDown={(e) => e.stopPropagation()}
            className="p-1.5 rounded hover:bg-destructive/20 hover:text-destructive transition-colors"
            title="Close"
          >
            <X className="h-4 w-4 pointer-events-none" />
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-64 border-r bg-muted/30 flex flex-col">
          <div className="p-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Rechercher..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-9"
              />
            </div>
          </div>
          <ScrollArea className="flex-1">
            <nav className="p-2 space-y-1">
              {filteredSections.map((section) => {
                const Icon = section.icon;
                const isActive = activeSection === section.id;
                return (
                  <button
                    key={section.id}
                    onClick={() => setActiveSection(section.id)}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors",
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-muted text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{section.label}</span>
                    {isActive && <ChevronRight className="h-4 w-4 ml-auto" />}
                  </button>
                );
              })}
            </nav>
          </ScrollArea>
        </div>

        {/* Content */}
        <ScrollArea className="flex-1">
          <div className="p-6 max-w-4xl">{renderContent()}</div>
        </ScrollArea>
      </div>
    </div>
  );
}

// Section Components

function HomeSection() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-2">Page d'Accueil</h1>
        <p className="text-muted-foreground">
          La page d'accueil est le point central du lanceur Kaizen, affichant un
          apercu rapide de toutes vos instances et statistiques.
        </p>
      </div>

      <Section title="Selecteur d'Instance">
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>Dropdown avec toutes vos instances</li>
          <li>Affiche le nom, la version MC et le statut</li>
          <li>Bouton de lancement/arret rapide</li>
          <li>Acces direct a la gestion de l'instance</li>
        </ul>
      </Section>

      <Section title="Statistiques">
        <p className="text-sm mb-2">Trois cartes de statistiques affichent:</p>
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>
            <strong>Instances totales</strong> - Nombre de clients et serveurs
          </li>
          <li>
            <strong>Mods installes</strong> - Total sur toutes les instances
          </li>
          <li>
            <strong>Temps de jeu</strong> - Temps accumule sur toutes les
            instances
          </li>
        </ul>
      </Section>

      <Section title="Instances Recentes">
        <p className="text-sm">
          Grille affichant jusqu'a 6 instances recemment jouees avec:
        </p>
        <ul className="list-disc list-inside space-y-1 text-sm mt-2">
          <li>Icone ou lettrine coloree</li>
          <li>Nom et version Minecraft</li>
          <li>Loader utilise (Fabric, Forge, etc.)</li>
          <li>Derniere fois jouee</li>
          <li>Temps de jeu</li>
        </ul>
      </Section>

      <Section title="QuickPlay (Mode Facile)">
        <p className="text-sm">
          En mode facile, l'onglet QuickPlay permet un lancement en un clic avec
          des parametres optimises automatiquement.
        </p>
      </Section>
    </div>
  );
}

function InstancesSection() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-2">Gestion des Instances</h1>
        <p className="text-muted-foreground">
          Creez, configurez et gerez vos instances Minecraft (clients, serveurs,
          proxies).
        </p>
      </div>

      <Section title="Creer une Instance">
        <ol className="list-decimal list-inside space-y-1 text-sm">
          <li>Cliquez "Nouvelle Instance"</li>
          <li>Choisissez le type: Client, Serveur ou Proxy</li>
          <li>Selectionnez la version Minecraft</li>
          <li>Choisissez un loader (Fabric, Forge, NeoForge, Quilt)</li>
          <li>Nommez votre instance</li>
          <li>Cliquez "Creer"</li>
        </ol>
      </Section>

      <Section title="Modes d'Affichage">
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>
            <strong>Grille</strong> - Cartes visuelles avec gradients
          </li>
          <li>
            <strong>Liste</strong> - Affichage compact en ligne
          </li>
          <li>
            <strong>Compact</strong> - Format minimaliste multi-colonnes
          </li>
        </ul>
      </Section>

      <Section title="Filtres et Tri">
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>Filtrer par type: Clients, Serveurs, Proxies</li>
          <li>Recherche par nom, version ou loader</li>
          <li>Tri par nom, derniere fois jouee, temps de jeu, version</li>
        </ul>
      </Section>

      <Section title="Details d'Instance">
        <p className="text-sm mb-2">La page de details contient plusieurs onglets:</p>
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>
            <strong>Parametres</strong> - Configuration generale, performance, serveur
          </li>
          <li>
            <strong>Contenu</strong> - Mods, plugins, resource packs, shaders
          </li>
          <li>
            <strong>Mondes</strong> - Gestion des worlds et sauvegardes
          </li>
          <li>
            <strong>Sauvegardes</strong> - Backup automatique et complet
          </li>
          <li>
            <strong>Configuration</strong> - Editeur de fichiers config
          </li>
          <li>
            <strong>Console</strong> - Logs en temps reel
          </li>
          <li>
            <strong>Tunnel</strong> - Configuration du tunneling (serveurs)
          </li>
        </ul>
      </Section>

      <Section title="Personnalisation">
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>12 couleurs disponibles pour la lettrine</li>
          <li>Upload d'icone personnalisee (PNG, JPG, GIF, WebP)</li>
          <li>Marquer comme favori (etoile)</li>
        </ul>
      </Section>
    </div>
  );
}

function AccountsSection() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-2">Gestion des Comptes</h1>
        <p className="text-muted-foreground">
          Kaizen Launcher supporte trois types de comptes pour jouer a
          Minecraft.
        </p>
      </div>

      <Section title="Compte Microsoft">
        <p className="text-sm mb-2">
          Authentification officielle Mojang avec toutes les fonctionnalites en
          ligne.
        </p>
        <ol className="list-decimal list-inside space-y-1 text-sm">
          <li>Cliquez "Ajouter un compte" puis "Microsoft"</li>
          <li>Un navigateur s'ouvre vers Microsoft</li>
          <li>Entrez le code affiche dans le lanceur</li>
          <li>Connectez-vous avec vos identifiants Microsoft</li>
          <li>Autorisez l'acces Xbox Live et Minecraft</li>
          <li>Le compte est ajoute automatiquement</li>
        </ol>
        <p className="text-sm mt-2 text-muted-foreground">
          Les tokens sont chiffres avec AES-256-GCM et renouveles
          automatiquement.
        </p>
      </Section>

      <Section title="Compte Hors-ligne">
        <p className="text-sm mb-2">
          Pour le developpement, les tests ou le jeu en LAN.
        </p>
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>Entrez simplement un nom d'utilisateur</li>
          <li>UUID genere automatiquement</li>
          <li>Limites: pas de serveurs en mode online, pas de skin en ligne</li>
        </ul>
      </Section>

      <Section title="Compte Kaizen">
        <p className="text-sm mb-2">
          Compte communautaire optionnel pour des fonctionnalites exclusives.
        </p>
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>Badges et permissions personnalises</li>
          <li>Acces aux fonctionnalites beta (patrons)</li>
          <li>Synchronisation entre appareils</li>
        </ul>
      </Section>

      <Section title="Gestion">
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>Un compte actif a la fois pour le lancement</li>
          <li>Basculer entre comptes en un clic</li>
          <li>Supprimer les comptes non utilises</li>
          <li>Rafraichir manuellement les tokens si necessaire</li>
        </ul>
      </Section>
    </div>
  );
}

function SkinsSection() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-2">Gestionnaire de Skins</h1>
        <p className="text-muted-foreground">
          Visualisez, modifiez et gerez vos skins et capes Minecraft.
        </p>
      </div>

      <Section title="Visualiseur 3D">
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>Modele 3D interactif avec rotation a la souris</li>
          <li>
            Animations: Idle, Marche, Course, Salut
          </li>
          <li>Zoom avant/arriere</li>
          <li>Arriere-plan personnalisable (theme, couleur, image)</li>
          <li>Capture d'ecran du skin</li>
        </ul>
      </Section>

      <Section title="Changer de Skin">
        <p className="text-sm mb-2">Deux methodes pour appliquer un nouveau skin:</p>
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>
            <strong>Depuis un fichier</strong> - Upload PNG depuis votre
            ordinateur
          </li>
          <li>
            <strong>Depuis une URL</strong> - Coller le lien direct vers l'image
          </li>
        </ul>
        <p className="text-sm mt-2">
          Choisissez la variante: Classique (Steve, bras 4px) ou Fin (Alex, bras
          3px)
        </p>
      </Section>

      <Section title="Skins Communautaires">
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>
            <strong>Tendances</strong> - Skins populaires de MineSkin
          </li>
          <li>
            <strong>Recents</strong> - Derniers skins uploades
          </li>
          <li>
            <strong>Recherche</strong> - Trouver par nom ou auteur
          </li>
          <li>
            <strong>Joueur</strong> - Rechercher le skin d'un joueur specifique
          </li>
        </ul>
      </Section>

      <Section title="Favoris">
        <p className="text-sm">
          Cliquez le coeur sur n'importe quel skin pour l'ajouter a vos favoris.
          Les favoris sont sauvegardes et accessibles depuis l'onglet dedie.
        </p>
      </Section>

      <Section title="Capes">
        <p className="text-sm mb-2">Sources de capes supportees:</p>
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>
            <strong>Mojang</strong> - Capes officielles (peuvent etre
            selectionnees)
          </li>
          <li>
            <strong>OptiFine</strong> - Apercu uniquement
          </li>
          <li>
            <strong>LabyMod</strong> - Apercu uniquement
          </li>
          <li>
            <strong>MinecraftCapes</strong> - Apercu uniquement
          </li>
        </ul>
      </Section>
    </div>
  );
}

function BrowseSection() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-2">Parcourir Modrinth</h1>
        <p className="text-muted-foreground">
          Decouvrez et installez des modpacks, mods, plugins et plus depuis
          Modrinth.
        </p>
      </div>

      <Section title="Types de Contenu">
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>
            <strong>Modpacks</strong> - Configurations completes de jeu
          </li>
          <li>
            <strong>Mods</strong> - Modifications individuelles
          </li>
          <li>
            <strong>Plugins</strong> - Pour serveurs Paper/Spigot
          </li>
          <li>
            <strong>Resource Packs</strong> - Textures et UI
          </li>
          <li>
            <strong>Shaders</strong> - Ameliorations graphiques
          </li>
          <li>
            <strong>Datapacks</strong> - Modifications serveur
          </li>
        </ul>
      </Section>

      <Section title="Recherche et Filtres">
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>Recherche par nom avec debounce (300ms)</li>
          <li>Tri: pertinence, telechargements, follows, recent, mis a jour</li>
          <li>Filtre par loader: Fabric, Forge, NeoForge, Quilt</li>
          <li>Categories: Adventure, Magic, Technology, Optimization...</li>
          <li>Modes d'affichage: Grille, Liste, Compact</li>
        </ul>
      </Section>

      <Section title="Installer un Modpack">
        <ol className="list-decimal list-inside space-y-1 text-sm">
          <li>Trouvez le modpack desire</li>
          <li>Cliquez sur "Installer"</li>
          <li>Selectionnez la version</li>
          <li>L'installation demarre automatiquement</li>
          <li>Une nouvelle instance est creee</li>
        </ol>
        <p className="text-sm mt-2 text-muted-foreground">
          Le processus telecharge tous les mods, extrait les configurations et
          cree l'instance prete a jouer.
        </p>
      </Section>

      <Section title="Installer des Mods">
        <ol className="list-decimal list-inside space-y-1 text-sm">
          <li>Selectionnez une instance cible</li>
          <li>Recherchez le mod</li>
          <li>Cliquez sur "Installer"</li>
          <li>Les dependances sont gerees automatiquement</li>
          <li>Le mod apparait dans l'onglet "Installes"</li>
        </ol>
      </Section>

      <Section title="Securite">
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>Verification SHA512 de tous les telechargements</li>
          <li>Liste blanche de domaines (CDN Modrinth, GitHub, Maven)</li>
          <li>Sanitization HTML des descriptions</li>
        </ul>
      </Section>
    </div>
  );
}

function BackupsSection() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-2">Sauvegardes</h1>
        <p className="text-muted-foreground">
          Protegez vos mondes et instances avec des sauvegardes locales et
          cloud.
        </p>
      </div>

      <Section title="Types de Sauvegardes">
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>
            <strong>Sauvegardes de Mondes</strong> - Backup individuel d'un
            world
          </li>
          <li>
            <strong>Sauvegardes d'Instances</strong> - Snapshot complet (mods,
            configs, worlds)
          </li>
        </ul>
      </Section>

      <Section title="Creer une Sauvegarde de Monde">
        <ol className="list-decimal list-inside space-y-1 text-sm">
          <li>Allez dans Details d'instance → Mondes</li>
          <li>Cliquez "Sauvegarder" sur le monde desire</li>
          <li>Un fichier ZIP est cree immediatement</li>
          <li>La sauvegarde apparait dans Sauvegardes → Mondes</li>
        </ol>
      </Section>

      <Section title="Creer une Sauvegarde d'Instance">
        <ol className="list-decimal list-inside space-y-1 text-sm">
          <li>Allez dans Details d'instance → Sauvegardes</li>
          <li>Cliquez "Creer une sauvegarde complete"</li>
          <li>Attendez la compression (peut prendre du temps)</li>
          <li>Un fichier .kaizen est cree</li>
        </ol>
      </Section>

      <Section title="Restaurer">
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>
            <strong>Monde</strong> - Selectionnez l'instance cible, confirmez
          </li>
          <li>
            <strong>Instance</strong> - Mode Remplacer (ecrase) ou Dupliquer
            (nouvelle)
          </li>
        </ul>
      </Section>

      <Section title="Stockage Cloud">
        <p className="text-sm mb-2">4 fournisseurs supportes:</p>
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>
            <strong>Google Drive</strong> - OAuth Device Code
          </li>
          <li>
            <strong>Dropbox</strong> - OAuth
          </li>
          <li>
            <strong>Nextcloud</strong> - WebDAV (auto-heberge)
          </li>
          <li>
            <strong>S3</strong> - AWS, MinIO, compatible
          </li>
        </ul>
        <p className="text-sm mt-2">
          Activez "Upload automatique" pour synchroniser les nouvelles
          sauvegardes.
        </p>
      </Section>
    </div>
  );
}

function SharingSection() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-2">Partage</h1>
        <p className="text-muted-foreground">
          Partagez vos instances et schematics avec d'autres joueurs via des
          tunnels P2P.
        </p>
      </div>

      <Section title="Partager une Instance">
        <ol className="list-decimal list-inside space-y-1 text-sm">
          <li>Allez dans Details d'instance → Exporter</li>
          <li>Selectionnez le contenu a inclure</li>
          <li>Cliquez "Exporter" pour creer le package</li>
          <li>Dans Partage, demarrez un nouveau partage</li>
          <li>Choisissez le fournisseur (Bore ou Cloudflare)</li>
          <li>Optionnel: Definissez un mot de passe</li>
          <li>Copiez l'URL publique et partagez-la</li>
        </ol>
      </Section>

      <Section title="Fournisseurs de Tunnel">
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>
            <strong>Bore</strong> - Simple, HTTP, ideal pour tests rapides
          </li>
          <li>
            <strong>Cloudflare Tunnel</strong> - HTTPS securise, URLs publiques
          </li>
        </ul>
      </Section>

      <Section title="Telecharger un Partage">
        <ol className="list-decimal list-inside space-y-1 text-sm">
          <li>Allez dans Partage</li>
          <li>Cliquez "Telecharger depuis un lien"</li>
          <li>Collez l'URL de partage</li>
          <li>Entrez le mot de passe si requis</li>
          <li>Previsualisation du contenu</li>
          <li>Cliquez "Telecharger et Importer"</li>
        </ol>
      </Section>

      <Section title="Schematics">
        <p className="text-sm mb-2">Formats supportes:</p>
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>
            <strong>.schem</strong> - WorldEdit/FAWE (recommande)
          </li>
          <li>
            <strong>.schematic</strong> - WorldEdit legacy
          </li>
          <li>
            <strong>.litematic</strong> - Litematica
          </li>
          <li>
            <strong>.nbt</strong> - Vanilla structure
          </li>
        </ul>
        <p className="text-sm mt-2">
          Importez, organisez avec des tags, copiez vers plusieurs instances, et
          partagez vos schematics.
        </p>
      </Section>

      <Section title="Statistiques en Temps Reel">
        <p className="text-sm">
          Suivez le nombre de telechargements, les octets uploades et la duree
          de seeding pour chaque partage actif.
        </p>
      </Section>
    </div>
  );
}

function SettingsSection() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-2">Parametres</h1>
        <p className="text-muted-foreground">
          Configurez l'apparence, Java, stockage, cloud et integrations.
        </p>
      </div>

      <Section title="Apparence">
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>
            <strong>Theme</strong> - Clair, Sombre, ou Systeme
          </li>
          <li>
            <strong>Langue</strong> - Francais, Anglais, Allemand, Neerlandais
          </li>
          <li>
            <strong>Personnalisation</strong> - Couleurs primaires, presets de
            theme
          </li>
        </ul>
      </Section>

      <Section title="Java">
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>Detection automatique des installations Java</li>
          <li>Installation en un clic via Eclipse Temurin (8, 11, 17, 21)</li>
          <li>
            Configuration memoire: Min/Max RAM avec recommandations
          </li>
          <li>Desinstallation des versions bundled</li>
        </ul>
      </Section>

      <Section title="Stockage">
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>Visualisation de l'espace utilise (graphique)</li>
          <li>Repartition: Instances, Java, Cache, Autres</li>
          <li>Changer le dossier des instances</li>
          <li>Vider le cache (libere de l'espace)</li>
          <li>Acces direct au dossier de donnees</li>
        </ul>
      </Section>

      <Section title="Cloud Backup">
        <p className="text-sm">
          Voir la section Sauvegardes pour la configuration des fournisseurs
          cloud.
        </p>
      </Section>

      <Section title="Discord">
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>
            <strong>Rich Presence</strong> - Affiche votre activite dans Discord
          </li>
          <li>Options: Nom d'instance, version MC, temps de jeu, loader</li>
          <li>
            <strong>Webhooks</strong> - Notifications Discord pour evenements
            serveur
          </li>
          <li>Evenements: Demarrage, arret, joueur rejoint/quitte, backup</li>
        </ul>
      </Section>

      <Section title="Mode Facile vs Avance">
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>
            <strong>Mode Facile</strong> - Interface simplifiee,
            auto-optimisation
          </li>
          <li>
            <strong>Mode Avance</strong> - Controle complet, tous les parametres
          </li>
        </ul>
        <p className="text-sm mt-2">
          Basculez via le switch dans la barre de titre.
        </p>
      </Section>

      <Section title="A Propos">
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>Version actuelle et mise a jour</li>
          <li>Liens GitHub et Discord</li>
          <li>Relancer l'assistant de configuration</li>
        </ul>
      </Section>
    </div>
  );
}

// Helper component
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="text-muted-foreground">{children}</div>
    </div>
  );
}
