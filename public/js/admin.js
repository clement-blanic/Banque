// admin.js : Espace Administrateur (statistiques, gestion des clients, gestion des comptes).
// Utilisé par admin.html.

(() => {
  'use strict';

  const state = {
    clients: [],
    comptes: [],
    clientSelectionne: null, // { user, comptes }
    compteHistorique: null,  // compte dont on consulte l'historique
    csrf: null
  };

  const NOMS_COMPTES = { 'courant': 'Compte courant', 'livret a': 'Livret A', 'pel': 'PEL' };

  const $ = (id) => document.getElementById(id);

  // ===================== FORMATAGE =====================

  const euros = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
  const formatEuro = (n) => euros.format(Number(n) || 0);

  const formatDate = (s) => new Date(s).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  const nomCompte = (c) => NOMS_COMPTES[(c.type_compte || '').toLowerCase()] || c.type_compte;

  // ===================== APPELS API =====================

  async function getCsrf(forcer = false) {
    if (state.csrf && !forcer) return state.csrf;
    const res = await fetch('/api/auth/csrf-token');
    state.csrf = (await res.json()).csrfToken;
    return state.csrf;
  }

  async function getJson(url) {
    const res = await fetch(url);
    if (res.status === 401) {
      window.location.href = '/login.html';
      throw new Error('Session expirée.');
    }
    if (res.status === 403) {
      window.location.href = '/dashboard.html';
      throw new Error('Accès réservé aux administrateurs.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.message || `Erreur ${res.status}`);
    return data;
  }

  async function sendJson(method, url, body, reessayer = true) {
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': await getCsrf()
      },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));

    if (res.status === 401) {
      window.location.href = '/login.html';
    }
    if (res.status === 403 && reessayer && /csrf/i.test(data.message || '')) {
      await getCsrf(true);
      return sendJson(method, url, body, false);
    }
    return { ok: res.ok, status: res.status, data };
  }

  // ===================== MESSAGES =====================

  let timerMessage;
  function showMessage(texte, type = 'error') {
    const el = $('admin-message');
    el.textContent = texte;
    el.className = `message ${type}-msg`;
    el.hidden = false;
    clearTimeout(timerMessage);
    timerMessage = setTimeout(() => (el.hidden = true), 5000);
  }

  // ===================== 1. STATISTIQUES =====================

  async function chargerStats() {
    const stats = await getJson('/api/users/stats');
    $('stat-clients').textContent = stats.total_clients;
    $('stat-comptes').textContent = stats.total_comptes;
    $('stat-depots').textContent = formatEuro(stats.total_depots);
  }

  // ===================== 2. GESTION DES CLIENTS =====================

  async function chargerClients(recherche = '') {
    const url = recherche
      ? `/api/users?q=${encodeURIComponent(recherche)}`
      : '/api/users';
    state.clients = await getJson(url);
    afficherClients();
    remplirSelectFiltreClient(recherche);
  }

  function afficherClients() {
    const tbody = $('clients-body');
    $('clients-etat').textContent = `${state.clients.length} client${state.clients.length > 1 ? 's' : ''}`;

    if (state.clients.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.className = 'muted';
      td.textContent = 'Aucun client trouvé.';
      tr.append(td);
      tbody.replaceChildren(tr);
      return;
    }

    const lignes = state.clients.map((client) => {
      const tr = document.createElement('tr');

      const tdId = document.createElement('td');
      tdId.className = 'muted';
      tdId.textContent = `#${client.id}`;

      const tdNom = document.createElement('td');
      tdNom.textContent = `${client.prenom} ${client.nom}`;

      const tdEmail = document.createElement('td');
      tdEmail.textContent = client.email;

      const tdTel = document.createElement('td');
      tdTel.textContent = client.telephone || '—';

      const tdActions = document.createElement('td');
      tdActions.className = 'actions-col';
      const actionsWrap = document.createElement('div');
      actionsWrap.className = 'table-actions';

      const btnDetail = document.createElement('button');
      btnDetail.type = 'button';
      btnDetail.className = 'btn btn-xs btn-secondary';
      btnDetail.textContent = 'Détail & comptes';
      btnDetail.addEventListener('click', () => ouvrirDetailClient(client.id));

      const btnSuppr = document.createElement('button');
      btnSuppr.type = 'button';
      btnSuppr.className = 'btn btn-xs btn-danger';
      btnSuppr.textContent = 'Supprimer';
      btnSuppr.addEventListener('click', () => supprimerClient(client.id, `${client.prenom} ${client.nom}`));

      actionsWrap.append(btnDetail, btnSuppr);
      tdActions.append(actionsWrap);

      tr.append(tdId, tdNom, tdEmail, tdTel, tdActions);
      return tr;
    });

    tbody.replaceChildren(...lignes);
  }

  // Voir le détail d'un client et ses comptes (GET /api/users/:id)
  async function ouvrirDetailClient(clientId) {
    try {
      const data = await getJson(`/api/users/${clientId}`);
      state.clientSelectionne = data;
      const { user, comptes } = data;

      $('titre-detail-client').textContent = `Client #${user.id} — ${user.prenom} ${user.nom}`;
      $('edit-prenom').value = user.prenom || '';
      $('edit-nom').value = user.nom || '';
      $('edit-email').value = user.email || '';
      $('edit-telephone').value = user.telephone || '';
      $('edit-date-naissance').value = user.date_naissance || '';
      $('edit-adresse').value = user.adresse_postale || '';

      afficherComptesDuClient(comptes, user);

      $('client-detail-card').hidden = false;
      $('client-detail-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (erreur) {
      showMessage(erreur.message);
    }
  }

  function afficherComptesDuClient(comptes, user) {
    const tbody = $('client-comptes-body');
    $('client-comptes-etat').textContent = comptes.length
      ? `${comptes.length} compte${comptes.length > 1 ? 's' : ''}`
      : 'Ce client ne possède aucun compte bancaire.';

    const lignes = comptes.map((c) => {
      const tr = document.createElement('tr');
      const bloque = c.statut === 'bloqué';

      const tdType = document.createElement('td');
      tdType.textContent = nomCompte(c);

      const tdIban = document.createElement('td');
      tdIban.className = 'iban';
      tdIban.textContent = c.iban;

      const tdSolde = document.createElement('td');
      tdSolde.className = 'num';
      tdSolde.textContent = formatEuro(c.solde);

      const tdStatut = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = `badge ${bloque ? 'badge-bloque' : 'badge-actif'}`;
      badge.textContent = bloque ? 'Bloqué' : 'Actif';
      tdStatut.append(badge);

      const tdActions = document.createElement('td');
      tdActions.className = 'actions-col';
      const wrap = document.createElement('div');
      wrap.className = 'table-actions';

      const btnStatut = document.createElement('button');
      btnStatut.type = 'button';
      btnStatut.className = `btn btn-xs ${bloque ? 'btn-secondary' : 'btn-danger'}`;
      btnStatut.textContent = bloque ? 'Débloquer' : 'Bloquer';
      btnStatut.addEventListener('click', () => changerStatutCompte(c));

      const btnHist = document.createElement('button');
      btnHist.type = 'button';
      btnHist.className = 'btn btn-xs btn-secondary';
      btnHist.textContent = 'Historique';
      btnHist.addEventListener('click', () => ouvrirHistoriqueCompte({
        ...c,
        prenom: user.prenom,
        nom: user.nom
      }));

      wrap.append(btnStatut, btnHist);
      tdActions.append(wrap);

      tr.append(tdType, tdIban, tdSolde, tdStatut, tdActions);
      return tr;
    });

    tbody.replaceChildren(...lignes);
  }

  // Modifier les informations d'un client (PUT /api/users/:id)
  async function enregistrerClient(event) {
    event.preventDefault();
    if (!state.clientSelectionne) return;

    const id = state.clientSelectionne.user.id;
    const body = {
      prenom: $('edit-prenom').value.trim(),
      nom: $('edit-nom').value.trim(),
      email: $('edit-email').value.trim(),
      telephone: $('edit-telephone').value.trim(),
      date_naissance: $('edit-date-naissance').value,
      adresse_postale: $('edit-adresse').value.trim()
    };

    const bouton = $('btn-save-client');
    bouton.disabled = true;

    try {
      const { ok, data } = await sendJson('PUT', `/api/users/${id}`, body);
      if (!ok) {
        const detail = data.erreurs?.map((e) => e.message).join(' ') || data.message || 'Modification refusée.';
        showMessage(detail);
        return;
      }
      showMessage('Informations du client mises à jour.', 'success');
      await Promise.all([
        chargerClients($('search-input').value.trim()),
        chargerComptes(),
        ouvrirDetailClient(id)
      ]);
    } catch {
      showMessage('Impossible de contacter le serveur.');
    } finally {
      bouton.disabled = false;
    }
  }

  // Supprimer un client avec confirmation (DELETE /api/users/:id)
  async function supprimerClient(id, nomComplet) {
    const confirme = window.confirm(
      `Confirmer la suppression définitive du client ${nomComplet} (#${id}) et de tous ses comptes ?`
    );
    if (!confirme) return;

    try {
      const { ok, data } = await sendJson('DELETE', `/api/users/${id}`, { confirmation: true });
      if (!ok) {
        showMessage(data.message || 'Suppression impossible.');
        return;
      }
      showMessage(`Client ${nomComplet} supprimé.`, 'success');

      if (state.clientSelectionne?.user.id === id) {
        $('client-detail-card').hidden = true;
        state.clientSelectionne = null;
      }
      await Promise.all([
        chargerStats(),
        chargerClients($('search-input').value.trim()),
        chargerComptes()
      ]);
    } catch {
      showMessage('Impossible de contacter le serveur.');
    }
  }

  // ===================== 3. GESTION DES COMPTES =====================

  async function chargerComptes() {
    state.comptes = await getJson('/api/comptes/tous');
    afficherComptes();
  }

  function remplirSelectFiltreClient(rechercheEnCours) {
    if (rechercheEnCours) return; // garde la liste complète des clients dans le filtre
    const select = $('filtre-client-select');
    const valeurActuelle = select.value;

    const optionTous = document.createElement('option');
    optionTous.value = '';
    optionTous.textContent = 'Tous les clients';

    const optionsClients = state.clients.map((c) => {
      const opt = document.createElement('option');
      opt.value = String(c.id);
      opt.textContent = `${c.prenom} ${c.nom} (${c.email})`;
      return opt;
    });

    select.replaceChildren(optionTous, ...optionsClients);
    select.value = valeurActuelle;
  }

  function afficherComptes() {
    const tbody = $('comptes-body');
    const filtreUserId = Number($('filtre-client-select').value) || null;

    const comptesFiltres = filtreUserId
      ? state.comptes.filter((c) => c.user_id === filtreUserId)
      : state.comptes;

    $('comptes-etat').textContent = `${comptesFiltres.length} compte${comptesFiltres.length > 1 ? 's' : ''}`;

    if (comptesFiltres.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 6;
      td.className = 'muted';
      td.textContent = 'Aucun compte bancaire à afficher.';
      tr.append(td);
      tbody.replaceChildren(tr);
      return;
    }

    const lignes = comptesFiltres.map((c) => {
      const tr = document.createElement('tr');
      const bloque = c.statut === 'bloqué';

      const tdClient = document.createElement('td');
      const btnClient = document.createElement('button');
      btnClient.type = 'button';
      btnClient.className = 'btn-link';
      btnClient.textContent = `${c.prenom} ${c.nom}`;
      btnClient.addEventListener('click', () => ouvrirDetailClient(c.user_id));
      tdClient.append(btnClient);

      const tdType = document.createElement('td');
      tdType.textContent = nomCompte(c);

      const tdIban = document.createElement('td');
      tdIban.className = 'iban';
      tdIban.textContent = c.iban;

      const tdSolde = document.createElement('td');
      tdSolde.className = 'num';
      tdSolde.textContent = formatEuro(c.solde);

      const tdStatut = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = `badge ${bloque ? 'badge-bloque' : 'badge-actif'}`;
      badge.textContent = bloque ? 'Bloqué' : 'Actif';
      tdStatut.append(badge);

      const tdActions = document.createElement('td');
      tdActions.className = 'actions-col';
      const wrap = document.createElement('div');
      wrap.className = 'table-actions';

      const btnStatut = document.createElement('button');
      btnStatut.type = 'button';
      btnStatut.className = `btn btn-xs ${bloque ? 'btn-secondary' : 'btn-danger'}`;
      btnStatut.textContent = bloque ? 'Débloquer' : 'Bloquer';
      btnStatut.addEventListener('click', () => changerStatutCompte(c));

      const btnHist = document.createElement('button');
      btnHist.type = 'button';
      btnHist.className = 'btn btn-xs btn-secondary';
      btnHist.textContent = 'Historique';
      btnHist.addEventListener('click', () => ouvrirHistoriqueCompte(c));

      wrap.append(btnStatut, btnHist);
      tdActions.append(wrap);

      tr.append(tdClient, tdType, tdIban, tdSolde, tdStatut, tdActions);
      return tr;
    });

    tbody.replaceChildren(...lignes);
  }

  // Bloquer / débloquer un compte (PATCH /api/comptes/:id/statut)
  async function changerStatutCompte(compte) {
    const nouveauStatut = compte.statut === 'actif' ? 'bloqué' : 'actif';
    const action = nouveauStatut === 'bloqué' ? 'bloquer' : 'débloquer';

    if (!window.confirm(`Voulez-vous vraiment ${action} le compte ${compte.iban} ?`)) {
      return;
    }

    try {
      const { ok, data } = await sendJson('PATCH', `/api/comptes/${compte.id}/statut`, {
        statut: nouveauStatut
      });
      if (!ok) {
        showMessage(data.message || 'Impossible de modifier le statut.');
        return;
      }
      showMessage(`Compte ${compte.iban} : statut passé à "${nouveauStatut}".`, 'success');

      await chargerComptes();
      if (state.clientSelectionne?.user.id === compte.user_id) {
        await ouvrirDetailClient(compte.user_id);
      }
    } catch {
      showMessage('Impossible de contacter le serveur.');
    }
  }

  // ===================== 4. HISTORIQUE D'UN COMPTE =====================

  function decrireTransaction(t, compteId) {
    if (t.type_transaction === 'depot') return { libelle: 'Dépôt', credit: true };
    if (t.type_transaction === 'retrait') return { libelle: 'Retrait', credit: false };
    return Number(t.compte_destinataire_id) === Number(compteId)
      ? { libelle: 'Virement reçu', credit: true, contrepartie: t.iban_source && `De ${t.iban_source}` }
      : { libelle: 'Virement émis', credit: false, contrepartie: t.iban_destinataire && `Vers ${t.iban_destinataire}` };
  }

  async function ouvrirHistoriqueCompte(compte) {
    state.compteHistorique = compte;
    const titulaire = compte.prenom ? `${compte.prenom} ${compte.nom} · ` : '';
    $('historique-compte-info').textContent =
      `${titulaire}${nomCompte(compte)} · ${compte.iban} · Solde : ${formatEuro(compte.solde)}`;
    $('historique-etat').textContent = 'Chargement…';
    $('historique-body').replaceChildren();
    $('historique-card').hidden = false;
    $('historique-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    try {
      const lignes = await getJson(`/api/transactions/historique/${compte.id}`);
      afficherHistorique(lignes, compte.id);
    } catch (erreur) {
      $('historique-etat').textContent = erreur.message;
    }
  }

  function afficherHistorique(lignes, compteId) {
    const tbody = $('historique-body');
    $('historique-etat').textContent = lignes.length
      ? `${lignes.length} opération${lignes.length > 1 ? 's' : ''}`
      : 'Aucune transaction enregistrée pour ce compte.';

    const rangees = lignes.map((t) => {
      const info = decrireTransaction(t, compteId);
      const tr = document.createElement('tr');

      const tdDate = document.createElement('td');
      tdDate.className = 'muted';
      tdDate.textContent = formatDate(t.date_transaction);

      const tdType = document.createElement('td');
      const pastille = document.createElement('span');
      pastille.className = `pill ${info.credit ? 'pill-credit' : 'pill-debit'}`;
      pastille.textContent = info.libelle;
      tdType.append(pastille);

      const tdLibelle = document.createElement('td');
      tdLibelle.textContent = t.description || '—';
      if (info.contrepartie) {
        const sous = document.createElement('small');
        sous.className = 'muted iban';
        sous.style.display = 'block';
        sous.textContent = info.contrepartie;
        tdLibelle.append(sous);
      }

      const tdMontant = document.createElement('td');
      tdMontant.className = `num ${info.credit ? 'credit' : 'debit'}`;
      tdMontant.textContent = `${info.credit ? '+' : '−'} ${formatEuro(t.montant)}`;

      tr.append(tdDate, tdType, tdLibelle, tdMontant);
      return tr;
    });

    tbody.replaceChildren(...rangees);
  }

  // ===================== DÉMARRAGE =====================

  async function init() {
    try {
      const { user } = await getJson('/api/auth/me');
      if (!user.is_admin) {
        window.location.href = '/dashboard.html';
        return;
      }
      $('user-name').textContent = `${user.prenom} ${user.nom}`;
    } catch {
      return;
    }

    // Recherche de clients
    $('search-form').addEventListener('submit', (e) => {
      e.preventDefault();
      chargerClients($('search-input').value.trim()).catch((err) => showMessage(err.message));
    });

    $('btn-reset-search').addEventListener('click', () => {
      $('search-input').value = '';
      chargerClients('').catch((err) => showMessage(err.message));
    });

    // Fiche détail client
    $('client-edit-form').addEventListener('submit', enregistrerClient);
    $('btn-delete-client').addEventListener('click', () => {
      if (!state.clientSelectionne) return;
      const u = state.clientSelectionne.user;
      supprimerClient(u.id, `${u.prenom} ${u.nom}`);
    });
    $('btn-fermer-client').addEventListener('click', () => {
      $('client-detail-card').hidden = true;
      state.clientSelectionne = null;
    });

    // Filtre des comptes par client
    $('filtre-client-select').addEventListener('change', afficherComptes);

    // Fermeture de l'historique d'un compte
    $('btn-fermer-historique').addEventListener('click', () => {
      $('historique-card').hidden = true;
      state.compteHistorique = null;
    });

    try {
      await Promise.all([
        chargerStats(),
        chargerClients(),
        chargerComptes()
      ]);
    } catch (erreur) {
      showMessage(erreur.message);
    }

    getCsrf().catch(() => {});
  }

  document.addEventListener('DOMContentLoaded', init);
})();
