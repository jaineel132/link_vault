import { useState, useEffect } from "react";
import './App.css';
import Header from './components/Header.jsx';
import FilterBar from './components/FilterBar.jsx';
import Sidebar from './components/sidebar.jsx';
import Linklist from './components/linklist.jsx';
import CollectionsPage from './components/collectionPage.jsx';
import AddLinkModal from './components/addlinkbtn.jsx';
import AddCollectionModal from './components/addcollectionbtn.jsx';
import ShareTarget from './components/ShareTarget.jsx';
import {
  getAllLinks, addLink, deleteLink, updateLink,
  getAllCollections, addCollection, deleteCollection,
} from "./api.js";

export default function App() {
  if (window.location.pathname === "/share-target") return <ShareTarget />;

  const [dark, setDark] = useState(() => localStorage.getItem('lv-theme') === 'dark');
  const [collections, setCollections] = useState([]);
  const [links, setLinks] = useState([]);
  const [activeCollectionId, setActiveCollectionId] = useState(null);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [showCollectionModal, setShowCollectionModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [editingLink, setEditingLink] = useState(null);
  const [view, setView] = useState("home");
  const [loading, setLoading] = useState(true);
  const [filterTag, setFilterTag] = useState(null);
  const [filterDomain, setFilterDomain] = useState(null);
  const [filterDate, setFilterDate] = useState(null);
  const [showFilters, setShowFilters] = useState(false);

  // Apply dark mode to <html>
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    localStorage.setItem('lv-theme', dark ? 'dark' : 'light');
  }, [dark]);

  useEffect(() => {
    async function load() {
      try {
        const [l, c] = await Promise.all([getAllLinks(), getAllCollections()]);
        setLinks(l || []);
        setCollections(c || []);
      } catch (e) {
        console.error('[App]', e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const filteredLinks = links.filter(link => {
    const matchesSearch = (link.name || "").toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCollection = activeCollectionId ? link.collectionId === activeCollectionId : true;
    const matchesTag = filterTag ? link.tags?.includes(filterTag) : true;
    const matchesDomain = filterDomain ? link.tags?.includes(filterDomain) : true;
    const matchesDate = (() => {
      if (!filterDate || !link.created_at) return true;
      const d = new Date(link.created_at), now = new Date();
      if (filterDate === "today") return d.toDateString() === now.toDateString();
      if (filterDate === "week") return d >= new Date(now - 7 * 86400000);
      if (filterDate === "month") return d >= new Date(now - 30 * 86400000);
      return true;
    })();
    return matchesSearch && matchesCollection && matchesTag && matchesDomain && matchesDate;
  });

  const saveLink = async (linkData, colId, notes, tags, existingId) => {
    try {
      if (existingId) {
        const updated = await updateLink(existingId, { ...linkData, collectionId: colId, notes, tags });
        setLinks(links.map(l => l.id === existingId ? updated : l));
      } else {
        const newLink = await addLink({ ...linkData, collectionId: colId, notes, tags });
        if (newLink.duplicate) { alert("Already in your vault!"); return; }
        setLinks([...links, newLink]);
      }
      setShowLinkModal(false);
      setEditingLink(null);
    } catch { alert("Failed to save link."); }
  };

  const deleteLink_ = async (id) => {
    if (!window.confirm("Delete this link?")) return;
    try {
      await deleteLink(id);
      setLinks(links.filter(l => l.id !== id));
    } catch { alert("Failed to delete."); }
  };

  const saveCollection = async (data) => {
    try {
      const c = await addCollection(data);
      setCollections([...collections, c]);
      setShowCollectionModal(false);
    } catch { alert("Failed to create collection."); }
  };

  const deleteCollection_ = async (id) => {
    if (!window.confirm("Delete this collection?")) return;
    try {
      await deleteCollection(id);
      setCollections(collections.filter(c => c.id !== id));
    } catch { alert("Failed to delete."); }
  };

  const exportData = () => {
    const blob = new Blob([JSON.stringify(links, null, 2)], { type: "application/json" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "linvault-export.json" });
    a.click(); URL.revokeObjectURL(a.href);
  };

  const goHome = () => { setActiveCollectionId(null); setSearchTerm(""); setView("home"); };

  return (
    <div className="lv-app">
      <Sidebar
        onGoHome={goHome}
        onGoCollections={() => setView("collections")}
        onAddCollection={() => setShowCollectionModal(true)}
        onExport={exportData}
        dark={dark}
        onToggleDark={() => setDark(d => !d)}
        collections={collections}
        activeCollectionId={activeCollectionId}
        onSelectCollection={(id) => { setActiveCollectionId(id); setView("home"); }}
      />

      <div className="lv-main">
        <Header
          onAddLink={() => setShowLinkModal(true)}
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          showFilters={showFilters}
          onToggleFilters={() => setShowFilters(f => !f)}
          showFilterBtn={view === "home"}
          activeCollectionId={activeCollectionId}
          collections={collections}
          onGoHome={goHome}
        />

        {view === "home" && showFilters && (
          <FilterBar
            links={links}
            filterTag={filterTag}
            filterDomain={filterDomain}
            filterDate={filterDate}
            onFilterTag={setFilterTag}
            onFilterDomain={setFilterDomain}
            onFilterDate={setFilterDate}
            onClear={() => { setFilterTag(null); setFilterDomain(null); setFilterDate(null); }}
          />
        )}

        <div className="lv-content">
          {loading ? (
            <div className="lv-loading"><div className="lv-spinner" /></div>
          ) : view === "home" ? (
            <Linklist
              links={filteredLinks}
              onEditLink={(link) => { setEditingLink(link); setShowLinkModal(true); }}
              onDeleteLink={(link) => deleteLink_(link.id)}
            />
          ) : (
            <CollectionsPage
              collections={collections}
              links={links}
              onSelectCollection={(id) => { setActiveCollectionId(id); setView("home"); }}
              onDeleteCollection={deleteCollection_}
            />
          )}
        </div>
      </div>

      {showLinkModal && (
        <AddLinkModal
          onClose={() => { setShowLinkModal(false); setEditingLink(null); }}
          onAdd={saveLink}
          collections={collections}
          editingLink={editingLink}
          allTags={[...new Set(links.flatMap(l => l.tags || []))]}
        />
      )}

      {showCollectionModal && (
        <AddCollectionModal
          onClose={() => setShowCollectionModal(false)}
          onAdd={saveCollection}
        />
      )}
    </div>
  );
}
