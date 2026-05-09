let dbClientes = JSON.parse(localStorage.getItem('motos_clientes')) || [];
let dbMotos = JSON.parse(localStorage.getItem('rodemos_motos')) || [];
let dbContratos = JSON.parse(localStorage.getItem('rodemos_contratos')) || [];
let dbReportes = JSON.parse(localStorage.getItem('rodemos_reportes')) || [];
let dbFacturas = JSON.parse(localStorage.getItem('rodemos_facturas')) || [];

let clienteSeleccionadoIdx = null;
let motoSeleccionadaIdx = null;
let fotosTemp = {};
let motoFotosTemp = {};
let otrosDocsTemp = [];
let ultimaCedulaAlertada = null;
let documentosBloqueados = true;
let nuevoDocumentoPendienteId = null;
let camaraStreamActivo = null;
let camaraDestinoActual = null;
let reservasPaginaActual = 1;
let reservasVistaActual = 'pendientes';
let solicitudSeleccionadaId = null;
let solicitudFolderActual = 'principal';
let solicitudLecturaActiva = false;
let solicitudLecturaActor = '';
let selectorActual = null;
let adminAutenticado = sessionStorage.getItem('rodemos_admin_auth') === '1';
let contratoModoActual = 'NUEVO';
let seleccionPendiente = null;
let contratoCambioPendienteCodigo = null;
let contratoCambioBase = null;
let contratoClockInterval = null;
let contratoPagosTemp = null;
let contratoUltimoCreado = null;
let modoEliminarClientes = false;
let clientesSeleccionadosEliminar = new Set();
let clientesPaginaActual = 1;
let facturasContratoActual = '';

const MAX_OTROS_DOCUMENTOS = 4;
const CLIENTES_POR_PAGINA = 18;
const DB_STORAGE = 'rodemos-storage';
const STORE_CONFIG = 'config';
const STORAGE_KEY = 'carpeta-base';
const DASHBOARD_STORAGE = 'rodemos-dashboard';
const LAST_PAGE_KEY = 'rodemos-last-page';
const ADMIN_PASSWORD_KEY = 'rodemos_admin_password';

const documentosBase = {
    rostro: { titulo: 'Foto rostro', nombre: 'FOTO-ROSTRO' },
    ced1: { titulo: 'Cedula frontal', nombre: 'CEDULA-FRENTE' },
    ced2: { titulo: 'Cedula trasera', nombre: 'CEDULA-TRASERA' },
    lic1: { titulo: 'Licencia frontal', nombre: 'LICENCIA-FRENTE' },
    lic2: { titulo: 'Licencia trasera', nombre: 'LICENCIA-TRASERA' }
};

const dashboardData = normalizarDashboardData(JSON.parse(localStorage.getItem(DASHBOARD_STORAGE)) || {});
let adminPassword = localStorage.getItem(ADMIN_PASSWORD_KEY) || '1234';

function normalizarDashboardData(data) {
    const tareas = Array.isArray(data.tareas) ? data.tareas : [];
    const solicitudes = Array.isArray(data.solicitudes) ? data.solicitudes : [];
    const reservas = Array.isArray(data.reservas) ? data.reservas : [];
    return {
        reservas,
        tareas: tareas.filter(item => item && item.origen !== 'asesora'),
        solicitudes: solicitudes.map(item => ({
            id: item.id || `sol-${Date.now()}`,
            asunto: item.asunto || 'SOLICITUD',
            estado: item.estado || 'abierta',
            carpeta: item.carpeta || (item.estado === 'cerrada' ? 'cerrados' : 'principal'),
            cliente: item.cliente || '',
            contratoCodigo: item.contratoCodigo || '',
            proceso: item.proceso || 'GENERAL',
            cerradoPor: item.cerradoPor || '',
            abiertoPor: item.abiertoPor || '',
            unreadAsesora: Number(item.unreadAsesora || 0),
            unreadAdmin: Number(item.unreadAdmin || 0),
            ultimaActividad: item.ultimaActividad || '',
            mensajes: Array.isArray(item.mensajes) ? item.mensajes : []
        }))
    };
}

async function loadPage(page) {
    try {
        const paginasValidas = ['inicio', 'clientes', 'motos', 'contratos', 'facturas', 'reportes', 'configuracion'];
        if (!paginasValidas.includes(page)) page = 'inicio';
        if (page === 'facturas' && !adminAutenticado) {
            pedirClaveAdminModal('Ingresa la clave de administrador para entrar a Facturas.', () => {
                adminAutenticado = true;
                sessionStorage.setItem('rodemos_admin_auth', '1');
                loadPage('facturas');
            });
            return;
        }
        sessionStorage.setItem(LAST_PAGE_KEY, page);
        const response = await fetch(`SECTIONS/${page}.html`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        document.getElementById('content-area').innerHTML = await response.text();
        marcarNavActiva(page);

        if (page === 'inicio') inicializarDashboard();
        if (page === 'clientes') inicializarClientes();
        if (page === 'motos') inicializarMotos();
        if (page === 'contratos') inicializarContratos();
        if (page === 'facturas') inicializarFacturas();
        if (page === 'reportes') inicializarReportes();
        if (page === 'configuracion') inicializarConfiguracion();
    } catch (e) {
        console.error(e);
        sessionStorage.removeItem(LAST_PAGE_KEY);
        const extra = location.protocol === 'file:' ? ' Abre la app desde el servidor local, no con doble clic al archivo index.html.' : '';
        mostrarAlerta('ERROR', `No se pudo cargar la seccion ${page}.${extra}`);
    }
}

function marcarNavActiva(page) {
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.page === page);
    });
}

function persistirClientes() { localStorage.setItem('motos_clientes', JSON.stringify(dbClientes)); }
function persistirMotos() { localStorage.setItem('rodemos_motos', JSON.stringify(dbMotos)); }
function persistirContratos() { localStorage.setItem('rodemos_contratos', JSON.stringify(dbContratos)); }
function persistirReportes() { localStorage.setItem('rodemos_reportes', JSON.stringify(dbReportes)); }
function persistirFacturas() { localStorage.setItem('rodemos_facturas', JSON.stringify(dbFacturas)); }
function persistirDashboard() { localStorage.setItem(DASHBOARD_STORAGE, JSON.stringify(dashboardData)); }

function obtenerFechaHoy() {
    const f = new Date();
    return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;
}

function obtenerFechaHoraActual() {
    return new Date().toLocaleString('es-CO', {
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    });
}

function formatearFechaVisible(fecha) {
    return fecha.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
}

function setTexto(id, valor) {
    const el = document.getElementById(id);
    if (el) el.innerText = valor;
}

function normalizarTextoArchivo(texto) {
    return String(texto || 'SIN-NOMBRE')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Z0-9]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .toUpperCase();
}

function normalizarBusqueda(texto) {
    return String(texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .trim();
}

function construirNombreArchivo(key, file) {
    return `${documentosBase[key].nombre}-${normalizarTextoArchivo(document.getElementById('cli-nombre')?.value || '')}.${obtenerExtension(file)}`;
}

function construirNombreArchivoOtro(titulo, file) {
    return `${normalizarTextoArchivo(titulo)}-${normalizarTextoArchivo(document.getElementById('cli-nombre')?.value || '')}.${obtenerExtension(file)}`;
}

function obtenerExtension(file) {
    const porNombre = file.name && file.name.includes('.') ? file.name.split('.').pop() : '';
    if (porNombre) return porNombre.toLowerCase();
    return file.type === 'application/pdf' ? 'pdf' : 'jpg';
}

function leerArchivo(file, fileName, callback) {
    const reader = new FileReader();
    reader.onload = e => callback({ dataUrl: e.target.result, fileName, mimeType: file.type || 'application/octet-stream' });
    reader.readAsDataURL(file);
}

function leerArchivoComoDocumento(file, fileName) {
    return new Promise(resolve => leerArchivo(file, fileName, resolve));
}

function dataUrlToBlob(dataUrl) {
    const partes = dataUrl.split(',');
    const mime = partes[0].match(/:(.*?);/)[1];
    const binario = atob(partes[1]);
    const bytes = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
    return new Blob([bytes], { type: mime });
}

function normalizarDocumento(documento, key, titulo) {
    if (!documento) return null;
    if (typeof documento === 'string') {
        return { dataUrl: documento, fileName: `${key ? documentosBase[key].nombre : normalizarTextoArchivo(titulo)}.jpg`, mimeType: 'image/jpeg' };
    }
    return documento;
}

function inicializarClientes() {
    clienteSeleccionadoIdx = null;
    fotosTemp = {};
    otrosDocsTemp = [];
    ultimaCedulaAlertada = null;
    limpiarFormularioCliente();
    renderizarDocumentosBase();
    renderizarOtrosDocumentos();
    setEstadoDocumentos(true);
    ocultarDetalleCliente();
    ocultarBusqueda('area-coincidencias', 'btn-principal-crear');
    clientesPaginaActual = 1;
    renderClientesListado();
}

function ocultarBusqueda(areaId, btnId) {
    const area = document.getElementById(areaId);
    const btn = document.getElementById(btnId);
    if (area) area.style.display = 'none';
    if (btn) btn.style.display = 'none';
}

function ocultarDetalleCliente() {
    const detalle = document.getElementById('detalle-completo');
    if (detalle) detalle.style.display = 'none';
}

function limpiarFormularioCliente() {
    ['nombre', 'doc', 'form-nombre', 'form-doc', 'email', 'tel', 'dir', 'barrio'].forEach(f => {
        const el = document.getElementById('cli-' + f);
        if (el) el.value = '';
    });
}

function buscarCoincidencias() {
    const n = document.getElementById('cli-nombre').value.toUpperCase().trim();
    const d = document.getElementById('cli-doc').value.trim();
    const area = document.getElementById('area-coincidencias');
    const lista = document.getElementById('lista-resultados');
    const btnCrear = document.getElementById('btn-principal-crear');
    const estaCreando = document.getElementById('detalle-completo')?.style.display === 'block' && clienteSeleccionadoIdx === null;

    clientesPaginaActual = 1;
    renderClientesListado();
    if (!n && !d) return ocultarBusqueda('area-coincidencias', 'btn-principal-crear');

    const terminos = n.split(' ').filter(Boolean);
    const filtrados = dbClientes.filter(c => (d && String(c.doc).includes(d)) || (terminos.length && terminos.every(t => String(c.nombre || '').includes(t))));
    const exacta = d ? dbClientes.find(c => String(c.doc) === String(d)) : null;

    if (exacta && ultimaCedulaAlertada !== d) {
        mostrarAlerta('CEDULA YA REGISTRADA', `La cedula ${d} ya existe a nombre de ${exacta.nombre}.`);
        ultimaCedulaAlertada = d;
    } else if (!exacta) {
        ultimaCedulaAlertada = null;
    }

    if (filtrados.length) {
        area.style.display = 'block';
        btnCrear.style.display = 'none';
        lista.innerHTML = filtrados.map(c => `<div class="doc-item" style="margin-bottom:8px"><div><strong>${c.nombre}</strong> <small>CC: ${c.doc}</small></div><button onclick="verDetalle(${dbClientes.indexOf(c)})" class="btn-listado" style="padding:5px 15px">Ver</button></div>`).join('');
        return;
    }

    area.style.display = 'none';
    btnCrear.style.display = estaCreando ? 'none' : 'block';
}

function obtenerClientesFiltrados() {
    const n = normalizarBusqueda(document.getElementById('cli-nombre')?.value || '');
    const d = String(document.getElementById('cli-doc')?.value || '').trim();
    const tokens = n.split(/\s+/).filter(Boolean);
    return dbClientes
        .map((cliente, idx) => ({ cliente, idx }))
        .filter(({ cliente }) => {
            const coincideDoc = d ? String(cliente.doc || '').includes(d) : true;
            const nombre = normalizarBusqueda(cliente.nombre || '');
            const coincideNombre = tokens.length ? tokens.every(token => nombre.includes(token)) : true;
            return coincideDoc && coincideNombre;
        })
        .sort((a, b) => String(a.cliente.nombre || '').localeCompare(String(b.cliente.nombre || '')));
}

function renderClientesListado() {
    const tabla = document.getElementById('clientes-listado-body');
    if (!tabla) return;
    const resumen = document.getElementById('clientes-listado-resumen');
    const paginacion = document.getElementById('clientes-listado-paginacion');
    const clientes = obtenerClientesFiltrados();
    const totalPaginas = Math.max(1, Math.ceil(clientes.length / CLIENTES_POR_PAGINA));
    if (clientesPaginaActual > totalPaginas) clientesPaginaActual = totalPaginas;
    const inicio = (clientesPaginaActual - 1) * CLIENTES_POR_PAGINA;
    const pagina = clientes.slice(inicio, inicio + CLIENTES_POR_PAGINA);

    if (resumen) {
        const desde = clientes.length ? inicio + 1 : 0;
        const hasta = inicio + pagina.length;
        resumen.innerText = `${clientes.length} clientes encontrados. Mostrando ${desde}-${hasta}.`;
    }

    tabla.innerHTML = pagina.length ? pagina.map(({ cliente, idx }) => `<tr>
        <td><b>${cliente.nombre || '-'}</b></td>
        <td>${cliente.doc || '-'}</td>
        <td>${cliente.tel || '-'}</td>
        <td>${cliente.barrio || '-'}</td>
        <td>${cliente.email || '-'}</td>
        <td><button class="btn-listado" onclick="verDetalle(${idx})">Abrir ficha</button></td>
    </tr>`).join('') : `<tr><td colspan="6" class="cliente-empty-row">No hay clientes con esta busqueda. Puedes crear uno nuevo.</td></tr>`;

    if (paginacion) {
        paginacion.innerHTML = `
            <button class="btn-listado" type="button" onclick="cambiarPaginaClientes(-1)" ${clientesPaginaActual <= 1 ? 'disabled' : ''}>Anterior</button>
            <span class="dashboard-page-label">Pagina ${clientesPaginaActual} de ${totalPaginas}</span>
            <button class="btn-listado" type="button" onclick="cambiarPaginaClientes(1)" ${clientesPaginaActual >= totalPaginas ? 'disabled' : ''}>Siguiente</button>
        `;
    }
}

function cambiarPaginaClientes(delta) {
    clientesPaginaActual += delta;
    renderClientesListado();
}

function abrirNuevoClienteDesdeListado() {
    document.getElementById('cli-nombre').value = '';
    document.getElementById('cli-doc').value = '';
    mostrarFormularioNuevo();
}

function cerrarFormularioCliente() {
    ocultarDetalleCliente();
    setEstadoDocumentos(true);
    renderClientesListado();
}

function mostrarFormularioNuevo() {
    const nombreActual = document.getElementById('cli-nombre').value.toUpperCase().trim();
    const docActual = document.getElementById('cli-doc').value.trim();
    clienteSeleccionadoIdx = null;
    fotosTemp = {};
    otrosDocsTemp = [];
    limpiarFormularioCliente();
    document.getElementById('cli-nombre').value = nombreActual;
    document.getElementById('cli-doc').value = docActual;
    const formNombre = document.getElementById('cli-form-nombre');
    const formDoc = document.getElementById('cli-form-doc');
    if (formNombre) formNombre.value = nombreActual;
    if (formDoc) formDoc.value = docActual;
    renderizarDocumentosBase();
    renderizarOtrosDocumentos();
    document.getElementById('detalle-completo').style.display = 'block';
    document.getElementById('cliente-modal-titulo').innerText = 'Crear cliente';
    document.getElementById('btn-principal-crear').style.display = 'none';
    ['form-nombre', 'form-doc', 'email', 'tel', 'dir', 'barrio'].forEach(f => document.getElementById('cli-' + f).readOnly = false);
    const btn = document.querySelector('#detalle-completo .btn-action');
    btn.innerText = 'GUARDAR REGISTRO';
    btn.style.background = 'var(--primary-red)';
    btn.onclick = validarYGuardarCliente;
    setEstadoDocumentos(false);
}

function verDetalle(idx) {
    clienteSeleccionadoIdx = idx;
    const c = dbClientes[idx];
    document.getElementById('detalle-completo').style.display = 'block';
    document.getElementById('cliente-modal-titulo').innerText = 'Ficha del cliente';
    ocultarBusqueda('area-coincidencias', 'btn-principal-crear');
    ['nombre', 'doc', 'email', 'tel', 'dir', 'barrio'].forEach(f => {
        const el = document.getElementById('cli-' + f);
        el.value = c[f] || '';
    });
    document.getElementById('cli-form-nombre').value = c.nombre || '';
    document.getElementById('cli-form-doc').value = c.doc || '';
    ['form-nombre', 'form-doc', 'email', 'tel', 'dir', 'barrio'].forEach(f => document.getElementById('cli-' + f).readOnly = true);
    cargarDocumentosCliente(c);
    setEstadoDocumentos(true);
    const btn = document.querySelector('#detalle-completo .btn-action');
    btn.innerText = 'MODIFICAR CLIENTE';
    btn.style.background = '#7a1c1c';
    btn.onclick = () => {
        ['form-nombre', 'form-doc', 'email', 'tel', 'dir', 'barrio'].forEach(f => document.getElementById('cli-' + f).readOnly = false);
        btn.innerText = 'GUARDAR CAMBIOS';
        btn.style.background = 'var(--primary-red)';
        btn.onclick = guardarExistente;
        setEstadoDocumentos(false);
    };
}

function cargarDocumentosCliente(cliente) {
    fotosTemp = {};
    otrosDocsTemp = [];
    Object.keys(documentosBase).forEach(key => {
        const documento = normalizarDocumento(cliente[key], key, documentosBase[key].titulo);
        if (documento) fotosTemp[key] = documento;
    });
    if (Array.isArray(cliente.otrosDocs)) {
        otrosDocsTemp = cliente.otrosDocs.map(doc => ({ id: doc.id, titulo: doc.titulo, archivo: normalizarDocumento(doc.archivo, null, doc.titulo) }));
    }
    renderizarDocumentosBase();
    renderizarOtrosDocumentos();
}

function setEstadoDocumentos(bloqueados) {
    documentosBloqueados = bloqueados;
    const helper = document.getElementById('docs-helper-text');
    if (helper) helper.innerText = bloqueados ? `Bloqueado hasta presionar MODIFICAR CLIENTE. Puedes agregar hasta ${MAX_OTROS_DOCUMENTOS} documentos extra.` : `Documentos habilitados. Puedes agregar hasta ${MAX_OTROS_DOCUMENTOS} documentos extra.`;
    document.querySelectorAll('[data-requires-edit="true"]').forEach(el => { el.disabled = bloqueados; });
    document.querySelectorAll('.doc-card').forEach(card => card.classList.toggle('locked', bloqueados));
}

function renderizarDocumentosBase() {
    Object.keys(documentosBase).forEach(key => actualizarTarjetaDocumento(key, fotosTemp[key] || null));
}

function actualizarTarjetaDocumento(key, archivo) {
    const preview = document.getElementById(`preview-${key}`);
    const empty = document.getElementById(`empty-${key}`);
    const name = document.getElementById(`name-${key}`);
    if (!preview || !empty || !name) return;
    if (archivo && archivo.dataUrl && archivo.dataUrl.startsWith('data:image')) {
        preview.src = archivo.dataUrl;
        preview.classList.add('has-image');
        empty.style.display = 'none';
    } else {
        preview.removeAttribute('src');
        preview.classList.remove('has-image');
        empty.style.display = 'flex';
        empty.innerText = archivo ? 'Archivo cargado' : 'Sin foto';
    }
    name.innerText = archivo ? archivo.fileName : 'Sin archivo';
}

function renderizarOtrosDocumentos() {
    const contenedor = document.getElementById('otros-documentos-list');
    if (!contenedor) return;
    const puedeAgregar = !documentosBloqueados && otrosDocsTemp.length < MAX_OTROS_DOCUMENTOS;
    if (!otrosDocsTemp.length) {
        contenedor.innerHTML = `<div class="doc-item doc-card"><div class="doc-meta"><strong>Sin documentos extra</strong><small>Puedes agregar hasta ${MAX_OTROS_DOCUMENTOS} documentos desde aqui.</small></div><div class="doc-actions"><button class="btn-icon" data-requires-edit="true" onclick="abrirModalNuevoDocumento()" ${puedeAgregar ? '' : 'disabled'}>Agregar documento</button></div></div>`;
        return;
    }
    contenedor.innerHTML = otrosDocsTemp.map(doc => {
        const archivo = doc.archivo;
        const preview = archivo && archivo.dataUrl && archivo.dataUrl.startsWith('data:image') ? `<img class="doc-preview has-image" src="${archivo.dataUrl}" alt="${doc.titulo}">` : `<div class="doc-preview-empty">${archivo ? 'Archivo cargado' : 'Sin archivo'}</div>`;
        return `<div class="doc-item doc-card"><div class="doc-preview-wrap" onclick="openOtroDocumento('${doc.id}')">${preview}</div><div class="doc-meta"><strong>${doc.titulo}</strong><small>${archivo ? archivo.fileName : 'Sin archivo'}</small></div><div class="doc-actions"><button class="btn-icon" onclick="openOtroDocumento('${doc.id}')">Ver</button><button class="btn-icon" data-requires-edit="true" onclick="abrirCamaraDocumento('otro', '${doc.id}')" ${documentosBloqueados ? 'disabled' : ''}>Camara</button><button class="btn-icon" data-requires-edit="true" onclick="document.getElementById('file-${doc.id}').click()" ${documentosBloqueados ? 'disabled' : ''}>Subir</button><button class="btn-icon" data-requires-edit="true" onclick="eliminarOtroDocumento('${doc.id}')" ${documentosBloqueados ? 'disabled' : ''}>Eliminar</button><input type="file" id="file-${doc.id}" hidden accept="image/*,.pdf" onchange="handleOtroFile(this, '${doc.id}')"></div></div>`;
    }).join('');
    if (puedeAgregar) contenedor.innerHTML += `<div class="doc-item doc-card"><div class="doc-meta"><strong>Agregar otro documento</strong><small>Puedes crear ${MAX_OTROS_DOCUMENTOS - otrosDocsTemp.length} documento(s) mas.</small></div><div class="doc-actions"><button class="btn-icon" data-requires-edit="true" onclick="abrirModalNuevoDocumento()">+ Agregar</button></div></div>`;
}

function abrirModalNuevoDocumento() {
    if (documentosBloqueados || otrosDocsTemp.length >= MAX_OTROS_DOCUMENTOS) return;
    nuevoDocumentoPendienteId = `otro-${Date.now()}`;
    document.getElementById('otro-doc-nombre').value = '';
    document.getElementById('modal-otro-documento').classList.add('show');
}

function cerrarModalNuevoDocumento() {
    document.getElementById('modal-otro-documento').classList.remove('show');
    nuevoDocumentoPendienteId = null;
}

function confirmarNuevoDocumento() {
    const titulo = document.getElementById('otro-doc-nombre').value.trim().toUpperCase();
    if (!titulo) return mostrarAlerta('NOMBRE REQUERIDO', 'Debes escribir un nombre para el documento.');
    const id = nuevoDocumentoPendienteId || `otro-${Date.now()}`;
    otrosDocsTemp.push({ id, titulo, archivo: null });
    cerrarModalNuevoDocumento();
    renderizarOtrosDocumentos();
}

function eliminarOtroDocumento(id) {
    otrosDocsTemp = otrosDocsTemp.filter(doc => doc.id !== id);
    renderizarOtrosDocumentos();
}

function handleFile(input, key) {
    if (documentosBloqueados) return;
    const file = input.files?.[0];
    if (!file) return;
    leerArchivo(file, construirNombreArchivo(key, file), archivo => {
        fotosTemp[key] = archivo;
        actualizarTarjetaDocumento(key, archivo);
    });
    input.value = '';
}

function handleOtroFile(input, id) {
    if (documentosBloqueados) return;
    const file = input.files?.[0];
    const doc = otrosDocsTemp.find(item => item.id === id);
    if (!file || !doc) return;
    leerArchivo(file, construirNombreArchivoOtro(doc.titulo, file), archivo => {
        doc.archivo = archivo;
        renderizarOtrosDocumentos();
    });
    input.value = '';
}

async function abrirCamaraDocumento(tipo, id) {
    if (documentosBloqueados || !navigator.mediaDevices?.getUserMedia) return mostrarAlerta('CAMARA NO DISPONIBLE', 'Este navegador no permite abrir la camara.');
    cerrarCamaraDocumento();
    camaraDestinoActual = { tipo, id };
    document.getElementById('camara-doc-label').innerText = `Captura una foto para ${tipo === 'base' ? documentosBase[id].titulo : (otrosDocsTemp.find(doc => doc.id === id)?.titulo || 'Documento')}.`;
    try {
        camaraStreamActivo = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        document.getElementById('camara-video').srcObject = camaraStreamActivo;
        document.getElementById('modal-camara-pc').classList.add('show');
    } catch (error) {
        console.error(error);
        mostrarAlerta('SIN ACCESO A CAMARA', 'No fue posible abrir la camara del PC.');
    }
}

function cerrarCamaraDocumento() {
    const video = document.getElementById('camara-video');
    if (video) {
        video.pause();
        video.srcObject = null;
    }
    if (camaraStreamActivo) {
        camaraStreamActivo.getTracks().forEach(track => track.stop());
        camaraStreamActivo = null;
    }
    camaraDestinoActual = null;
    const modal = document.getElementById('modal-camara-pc');
    if (modal) modal.classList.remove('show');
}

function capturarFotoDesdeCamara() {
    if (!camaraDestinoActual) return;
    const video = document.getElementById('camara-video');
    const canvas = document.getElementById('camara-canvas');
    if (!video.videoWidth || !video.videoHeight) return mostrarAlerta('CAMARA NO LISTA', 'Espera un momento a que la camara cargue.');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    if (camaraDestinoActual.tipo === 'base') {
        const key = camaraDestinoActual.id;
        fotosTemp[key] = { dataUrl, fileName: `${documentosBase[key].nombre}-${normalizarTextoArchivo(document.getElementById('cli-nombre')?.value || '')}.jpg`, mimeType: 'image/jpeg' };
        actualizarTarjetaDocumento(key, fotosTemp[key]);
    } else {
        const doc = otrosDocsTemp.find(item => item.id === camaraDestinoActual.id);
        if (doc) {
            doc.archivo = { dataUrl, fileName: `${normalizarTextoArchivo(doc.titulo)}-${normalizarTextoArchivo(document.getElementById('cli-nombre')?.value || '')}.jpg`, mimeType: 'image/jpeg' };
            renderizarOtrosDocumentos();
        }
    }
    cerrarCamaraDocumento();
}

function openLightbox(key) { abrirArchivo(fotosTemp[key]); }
function openOtroDocumento(id) { abrirArchivo(otrosDocsTemp.find(item => item.id === id)?.archivo); }

function abrirArchivo(archivo) {
    if (!archivo?.dataUrl) return mostrarAlerta('SIN ARCHIVO', 'Todavia no hay un archivo cargado.');
    if (archivo.dataUrl.startsWith('data:image')) {
        document.getElementById('img-lightbox').src = archivo.dataUrl;
        document.getElementById('lightbox').style.display = 'flex';
    } else {
        window.open(archivo.dataUrl, '_blank');
    }
}

async function guardarExistente() {
    const idx = clienteSeleccionadoIdx;
    const previo = JSON.parse(JSON.stringify(dbClientes[idx]));
    dbClientes[idx] = construirClienteDesdeFormulario({ ...dbClientes[idx] });
    persistirClientes();
    dbClientes[idx] = await exportarCarpetaCliente(dbClientes[idx], previo);
    persistirClientes();
    finalizarGuardadoCliente('Cliente actualizado correctamente.');
}

async function validarYGuardarCliente() {
    const n = (document.getElementById('cli-form-nombre')?.value || document.getElementById('cli-nombre').value).toUpperCase().trim();
    const d = (document.getElementById('cli-form-doc')?.value || document.getElementById('cli-doc').value).trim();
    document.getElementById('cli-nombre').value = n;
    document.getElementById('cli-doc').value = d;
    if (!n || !d) return mostrarAlerta('DATOS INCOMPLETOS', 'Nombre y cedula son obligatorios.');
    if (dbClientes.some(c => String(c.doc) === String(d) && dbClientes.indexOf(c) !== clienteSeleccionadoIdx)) return mostrarAlerta('CEDULA YA REGISTRADA', `La cedula ${d} ya existe.`);
    const cliente = construirClienteDesdeFormulario({});
    if (clienteSeleccionadoIdx === null) {
        dbClientes.push(cliente);
        persistirClientes();
        dbClientes[dbClientes.length - 1] = await exportarCarpetaCliente(dbClientes[dbClientes.length - 1], null);
    } else {
        const previo = JSON.parse(JSON.stringify(dbClientes[clienteSeleccionadoIdx]));
        dbClientes[clienteSeleccionadoIdx] = cliente;
        persistirClientes();
        dbClientes[clienteSeleccionadoIdx] = await exportarCarpetaCliente(dbClientes[clienteSeleccionadoIdx], previo);
    }
    persistirClientes();
    finalizarGuardadoCliente('Cliente guardado correctamente.');
}

function construirClienteDesdeFormulario(base) {
    const nombre = (document.getElementById('cli-form-nombre')?.value || document.getElementById('cli-nombre').value).toUpperCase().trim();
    const doc = (document.getElementById('cli-form-doc')?.value || document.getElementById('cli-doc').value).trim();
    document.getElementById('cli-nombre').value = nombre;
    document.getElementById('cli-doc').value = doc;
    return { ...base, nombre, doc, email: document.getElementById('cli-email').value.trim(), tel: document.getElementById('cli-tel').value.trim(), dir: document.getElementById('cli-dir').value.trim(), barrio: document.getElementById('cli-barrio').value.trim(), ...fotosTemp, otrosDocs: otrosDocsTemp.map(doc => ({ id: doc.id, titulo: doc.titulo, archivo: doc.archivo })) };
}

function finalizarGuardadoCliente(mensaje) {
    loadPage('clientes').then(() => mostrarAlerta('PROCESO COMPLETADO', mensaje));
}

async function exportarCarpetaCliente(cliente, clientePrevio) {
    if (!window.showDirectoryPicker) return cliente;
    try {
        const baseDir = await obtenerSubcarpetaBase('clientes');
        if (!baseDir) return cliente;
        const nombreCarpetaNueva = normalizarTextoArchivo(cliente.nombre);
        const nombreCarpetaAnterior = clientePrevio?.storageFolderName || null;
        const carpetaCliente = await baseDir.getDirectoryHandle(nombreCarpetaNueva, { create: true });
        if (nombreCarpetaAnterior && nombreCarpetaAnterior !== nombreCarpetaNueva) await limpiarCarpetaAnterior(baseDir, nombreCarpetaAnterior);
        await escribirArchivoTexto(carpetaCliente, 'FICHA-CLIENTE.txt', [`NOMBRE: ${cliente.nombre}`, `CEDULA: ${cliente.doc}`, `TIPO ID: ${cliente.tipoId || 'CC'}`, `EMAIL: ${cliente.email || ''}`, `TELEFONO 1: ${cliente.tel || ''}`, `TELEFONO 2: ${cliente.tel2 || ''}`, `DIRECCION: ${cliente.dir || ''}`, `BARRIO: ${cliente.barrio || ''}`, `CIUDAD: ${cliente.ciudad || ''}`, `DIAS ALQUILER: ${cliente.diasAlquiler || ''}`].join('\n'));
        const archivosActuales = ['FICHA-CLIENTE.txt'];
        for (const key of Object.keys(documentosBase)) {
            if (cliente[key]?.dataUrl) {
                await escribirArchivoBinario(carpetaCliente, cliente[key]);
                archivosActuales.push(cliente[key].fileName);
            }
        }
        for (const doc of cliente.otrosDocs || []) {
            if (doc.archivo?.dataUrl) {
                await escribirArchivoBinario(carpetaCliente, doc.archivo);
                archivosActuales.push(doc.archivo.fileName);
            }
        }
        const previos = clientePrevio?.archivosGuardados || [];
        for (const nombre of previos.filter(nombre => !archivosActuales.includes(nombre))) await eliminarArchivoSiExiste(carpetaCliente, nombre);
        return { ...cliente, storageFolderName: nombreCarpetaNueva, archivosGuardados: archivosActuales };
    } catch (error) {
        console.error(error);
        mostrarAlerta('NO SE PUDO EXPORTAR', 'El cliente si quedo guardado en la app, pero no fue posible escribir la carpeta.');
        return cliente;
    }
}

async function obtenerSubcarpetaBase(nombre) {
    const baseDir = await obtenerCarpetaBase();
    if (!baseDir) return null;
    return baseDir.getDirectoryHandle(nombre, { create: true });
}

async function prepararCarpetasBase() {
    if (!window.showDirectoryPicker) return mostrarAlerta('NO DISPONIBLE', 'Tu navegador no permite seleccionar carpetas.');
    const base = await obtenerCarpetaBase();
    if (!base) return;
    await base.getDirectoryHandle('clientes', { create: true });
    await base.getDirectoryHandle('motos', { create: true });
    await base.getDirectoryHandle('contratos', { create: true });
    mostrarAlerta('CARPETAS LISTAS', 'Se verificaron las carpetas clientes, motos y contratos dentro de Rodemos.');
    actualizarRutaAdministracion();
}

async function limpiarCarpetaAnterior(baseDir, nombreCarpetaAnterior) {
    try { await baseDir.removeEntry(nombreCarpetaAnterior, { recursive: true }); } catch {}
}

async function eliminarArchivoSiExiste(carpeta, nombreArchivo) {
    try { await carpeta.removeEntry(nombreArchivo); } catch {}
}

async function escribirArchivoTexto(carpeta, nombreArchivo, contenido) {
    const fileHandle = await carpeta.getFileHandle(nombreArchivo, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(contenido);
    await writable.close();
}

async function escribirArchivoBinario(carpeta, archivo) {
    const fileHandle = await carpeta.getFileHandle(archivo.fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(dataUrlToBlob(archivo.dataUrl));
    await writable.close();
}

async function obtenerCarpetaBase() {
    let handle = await leerHandleGuardado();
    if (!handle || !(await verificarPermisoHandle(handle))) handle = await seleccionarCarpetaBase();
    return handle;
}

async function seleccionarCarpetaBase() {
    try {
        const handle = await window.showDirectoryPicker({ id: 'rodemos-base', startIn: 'desktop', mode: 'readwrite' });
        await guardarHandleGuardado(handle);
        return handle;
    } catch {
        return null;
    }
}

async function verificarPermisoHandle(handle) {
    const permiso = await handle.queryPermission({ mode: 'readwrite' });
    if (permiso === 'granted') return true;
    return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
}

function abrirStorageDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_STORAGE, 1);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_CONFIG)) db.createObjectStore(STORE_CONFIG);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function guardarHandleGuardado(handle) {
    const db = await abrirStorageDB();
    await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_CONFIG, 'readwrite');
        tx.objectStore(STORE_CONFIG).put(handle, STORAGE_KEY);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
    db.close();
}

async function leerHandleGuardado() {
    const db = await abrirStorageDB();
    const resultado = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_CONFIG, 'readonly');
        const request = tx.objectStore(STORE_CONFIG).get(STORAGE_KEY);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
    db.close();
    return resultado;
}

async function obtenerCarpetaBaseSilenciosa() {
    try {
        const handle = await leerHandleGuardado();
        if (!handle) return null;
        const permiso = await handle.queryPermission({ mode: 'readwrite' });
        return permiso === 'granted' ? handle : null;
    } catch {
        return null;
    }
}

async function obtenerSubcarpetaBaseSilenciosa(nombre) {
    const base = await obtenerCarpetaBaseSilenciosa();
    if (!base) return null;
    try {
        return await base.getDirectoryHandle(nombre, { create: true });
    } catch {
        return null;
    }
}

function abrirListado() {
    const tabla = document.getElementById('tabla-excel-body');
    if (!tabla) return;
    dbClientes.sort((a, b) => a.nombre.localeCompare(b.nombre));
    const thEliminar = document.getElementById('th-eliminar-clientes');
    if (thEliminar) thEliminar.style.display = modoEliminarClientes ? 'table-cell' : 'none';
    const btnConfirmar = document.getElementById('btn-confirmar-eliminar-clientes');
    const btnCancelar = document.getElementById('btn-cancelar-eliminar-clientes');
    if (btnConfirmar) btnConfirmar.style.display = modoEliminarClientes ? 'inline-flex' : 'none';
    if (btnCancelar) btnCancelar.style.display = modoEliminarClientes ? 'inline-flex' : 'none';
    tabla.innerHTML = dbClientes.map((c, idx) => `<tr>
        <td style="display:${modoEliminarClientes ? 'table-cell' : 'none'};"><input type="checkbox" ${clientesSeleccionadosEliminar.has(String(c.doc)) ? 'checked' : ''} onchange="toggleSeleccionEliminarCliente('${String(c.doc)}', this.checked)"></td>
        <td><b>${c.nombre}</b></td>
        <td>${c.doc}</td>
        <td>${c.tel || '-'}</td>
        <td>${c.barrio || '-'}</td>
        <td><button class="btn-listado" style="padding:2px 10px" onclick="cerrarModales(); verDetalle(${idx})">Ver</button></td>
    </tr>`).join('');
    document.getElementById('modal-listado').classList.add('show');
}

function activarModoEliminarClientes() {
    const clave = window.prompt('Ingresa la clave de administrador para habilitar eliminacion');
    if (clave === null) return;
    if (clave !== adminPassword) return mostrarAlerta('CLAVE INCORRECTA', 'La clave de administrador no es valida.');
    modoEliminarClientes = true;
    clientesSeleccionadosEliminar = new Set();
    abrirListado();
}

function cancelarModoEliminarClientes() {
    modoEliminarClientes = false;
    clientesSeleccionadosEliminar = new Set();
    abrirListado();
}

function toggleSeleccionEliminarCliente(doc, seleccionado) {
    const key = String(doc);
    if (seleccionado) clientesSeleccionadosEliminar.add(key);
    else clientesSeleccionadosEliminar.delete(key);
}

function eliminarClientesSeleccionados() {
    if (!clientesSeleccionadosEliminar.size) return mostrarAlerta('SIN SELECCION', 'Selecciona uno o varios clientes para eliminar.');
    const clave = window.prompt('Confirma la clave de administrador para eliminar los clientes seleccionados');
    if (clave === null) return;
    if (clave !== adminPassword) return mostrarAlerta('CLAVE INCORRECTA', 'La clave de administrador no es valida.');
    dbClientes = dbClientes.filter(cliente => !clientesSeleccionadosEliminar.has(String(cliente.doc)));
    persistirClientes();
    clientesSeleccionadosEliminar = new Set();
    modoEliminarClientes = false;
    abrirListado();
    mostrarAlerta('CLIENTES ELIMINADOS', 'Los clientes seleccionados fueron eliminados correctamente.');
}

function encabezadosClientesCSV() {
    return ['Nombre completo', 'Numero ID', 'Tipo ID', 'Telefono 1', 'Telefono 2', 'Direccion', 'Barrio', 'Ciudad', 'Correo electronico', 'Numero dias alquiler', 'Estado'];
}

function descargarCSV(nombre, encabezados, filas = []) {
    const separador = ';';
    let csv = `\uFEFFsep=;\n${encabezados.map(escaparCSV).join(separador)}\n`;
    filas.forEach(fila => { csv += `${fila.map(escaparCSV).join(separador)}\n`; });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    link.download = nombre;
    link.click();
}

function descargarPlantillaClientes() {
    descargarCSV('plantilla_clientes_rodemos.csv', encabezadosClientesCSV(), [[
        'NOMBRE EJEMPLO',
        '123456789',
        'CC',
        '3000000000',
        '',
        'CALLE 1 # 2-3',
        'CENTRO',
        'CALI',
        'correo@ejemplo.com',
        '7',
        'ACTIVO'
    ]]);
}

function prepararImportacionClientes() {
    descargarPlantillaClientes();
    setTimeout(() => document.getElementById('input-importar-clientes')?.click(), 300);
}

function exportarExcel() {
    const encabezados = encabezadosClientesCSV();
    const filas = dbClientes.map(cliente => [
        cliente.nombre || '',
        cliente.doc || '',
        cliente.tipoId || cliente.tipoID || 'CC',
        cliente.tel || cliente.telefono1 || '',
        cliente.tel2 || cliente.telefono2 || '',
        cliente.dir || cliente.direccion || '',
        cliente.barrio || '',
        cliente.ciudad || '',
        cliente.email || '',
        cliente.diasAlquiler || '',
        cliente.estado || 'ACTIVO'
    ]);
    descargarCSV('clientes_rodemos.csv', encabezados, filas);
}

function escaparCSV(valor) {
    return `"${String(valor ?? '').replace(/"/g, '""')}"`;
}

function importarClientes(input) {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async e => {
        try {
            const filas = parseCSV(String(e.target.result || ''));
            const encabezados = filas[0].map(normalizarEncabezadoImportacion);
            const exportarPendientes = [];
            for (let i = 1; i < filas.length; i++) {
                const fila = filas[i];
                if (!fila.some(col => String(col || '').trim())) continue;
                const registro = construirClienteDesdeFila(encabezados, fila);
                if (!registro.doc) continue;
                const existenteIdx = dbClientes.findIndex(item => String(item.doc) === String(registro.doc));
                if (existenteIdx >= 0) {
                    dbClientes[existenteIdx] = { ...dbClientes[existenteIdx], ...registro };
                    exportarPendientes.push(existenteIdx);
                } else {
                    dbClientes.push(registro);
                    exportarPendientes.push(dbClientes.length - 1);
                }
            }
            for (const idx of exportarPendientes) dbClientes[idx] = await exportarCarpetaCliente(dbClientes[idx], null);
            persistirClientes();
            abrirListado();
        } catch {
            mostrarAlerta('ERROR AL IMPORTAR', 'No fue posible leer el archivo CSV.');
        } finally {
            input.value = '';
        }
    };
    reader.readAsText(file, 'utf-8');
}

function normalizarEncabezadoImportacion(valor) {
    return String(valor || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '');
}

function construirClienteDesdeFila(encabezados, fila) {
    const mapa = {};
    encabezados.forEach((encabezado, idx) => mapa[encabezado] = fila[idx] || '');
    return {
        nombre: String(mapa.nombre || mapa.nombrecompleto || '').toUpperCase().trim(),
        doc: String(mapa.documento || mapa.numeroid || mapa.cedula || mapa.cc || '').trim(),
        tipoId: String(mapa.tipoid || mapa.tipodeid || 'CC').toUpperCase().trim(),
        email: String(mapa.email || mapa.correoelectronico || mapa.correo || '').trim(),
        tel: String(mapa.telefono || mapa.telefono1 || '').trim(),
        tel2: String(mapa.telefono2 || '').trim(),
        dir: String(mapa.direccion || '').trim(),
        barrio: String(mapa.barrio || '').trim(),
        ciudad: String(mapa.ciudad || '').trim(),
        diasAlquiler: String(mapa.numerodiasalquiler || mapa.numerodediasdealquiler || mapa.diasalquiler || '').trim(),
        estado: String(mapa.estado || 'ACTIVO').toUpperCase().trim()
    };
}

function parseCSV(texto) {
    texto = String(texto || '').replace(/^\uFEFF/, '');
    const filas = [];
    let fila = [];
    let valor = '';
    let dentro = false;
    let separador = texto.includes('sep=;') || (texto.split('\n')[0] || '').includes(';') ? ';' : ',';
    if (texto.toLowerCase().startsWith('sep=;')) texto = texto.split(/\r?\n/).slice(1).join('\n');
    for (let i = 0; i < texto.length; i++) {
        const c = texto[i];
        const s = texto[i + 1];
        if (c === '"') {
            if (dentro && s === '"') { valor += '"'; i++; }
            else dentro = !dentro;
        } else if (c === separador && !dentro) {
            fila.push(valor); valor = '';
        } else if ((c === '\n' || c === '\r') && !dentro) {
            if (c === '\r' && s === '\n') i++;
            fila.push(valor); filas.push(fila); fila = []; valor = '';
        } else {
            valor += c;
        }
    }
    if (valor.length || fila.length) { fila.push(valor); filas.push(fila); }
    return filas;
}

function inicializarDashboard() {
    const filtro = document.getElementById('reserva-vista');
    if (filtro && !filtro.value) filtro.value = 'dia';
    const btnReserva = document.getElementById('btn-generar-reserva');
    if (btnReserva) btnReserva.onclick = abrirModalReserva;
    cerrarModalSolicitud();
    limpiarFormularioReserva();
    cerrarModalReserva();
    reservasPaginaActual = 1;
    poblarClientesSolicitud();
    actualizarContratosSolicitud();
    solicitudSeleccionadaId = dashboardData.solicitudes[0]?.id || null;
    renderDashboard();
}

function renderDashboard() {
    renderReservas();
    renderTareas();
    renderSolicitudes(false);
    renderResumenDashboard();
}

function renderResumenDashboard() {
    setTexto('resumen-reservas-hoy', String(dashboardData.reservas.filter(item => item.fecha === obtenerFechaHoy()).length));
    setTexto('resumen-tareas-pendientes', String(dashboardData.tareas.filter(item => item.estado !== 'completada').length));
    setTexto('resumen-solicitudes', String(dashboardData.solicitudes.filter(item => item.estado !== 'cerrada').length));
    const pendientesAsesora = dashboardData.solicitudes.reduce((total, item) => total + Number(item.unreadAsesora || 0), 0);
    setTexto('resumen-mensajes-pendientes', String(pendientesAsesora));
    setTexto('resumen-alertas-vencimientos', String(obtenerAlertasVencimientoMotos().length));
}

function renderReservas() {
    const vista = document.getElementById('reserva-vista')?.value || 'dia';
    const contenedor = document.getElementById('reserva-lista');
    const etiqueta = document.getElementById('reserva-rango');
    if (!contenedor || !etiqueta) return;
    const hoy = new Date();
    const inicio = new Date(hoy);
    const fin = new Date(hoy);
    if (vista === 'semana') {
        const dia = hoy.getDay() || 7;
        inicio.setDate(hoy.getDate() - dia + 1);
        fin.setDate(inicio.getDate() + 6);
    } else if (vista === 'mes') {
        inicio.setDate(1);
        fin.setMonth(hoy.getMonth() + 1, 0);
    }
    etiqueta.innerText = `${formatearFechaVisible(inicio)} - ${formatearFechaVisible(fin)}`;
    const reservasFiltradas = dashboardData.reservas.filter(item => {
        const fecha = new Date(`${item.fecha}T00:00:00`);
        return fecha >= inicio && fecha <= fin;
    }).sort((a, b) => `${a.fecha} ${a.hora}`.localeCompare(`${b.fecha} ${b.hora}`));
    if (!reservasFiltradas.length) {
        contenedor.innerHTML = '<div class="dashboard-empty">No hay reservas en este rango.</div>';
    } else {
        contenedor.innerHTML = reservasFiltradas.map(item => `
            <div class="dashboard-item dashboard-item-reserva">
                <div>
                    <strong>${item.cliente}</strong>
                    <small>${item.fecha} · ${item.hora} · ${item.tipo}${item.abono ? ` · Abono: ${item.abono}` : ''}${item.contratoCodigo ? ` · Contrato: ${item.contratoCodigo}` : ''}</small>
                </div>
                <div class="doc-actions">
                    <button class="btn-icon" onclick="editarReserva('${item.id}')">Editar</button>
                    <button class="btn-icon" onclick="eliminarReserva('${item.id}')">Eliminar</button>
                    <button class="btn-icon" onclick="verReciboReserva('${item.id}')">Recibo</button>
                    ${item.soporte?.dataUrl ? `<button class="btn-icon" onclick="abrirArchivo(${JSON.stringify(item.soporte).replace(/"/g, '&quot;')})">Soporte</button>` : ''}
                </div>
            </div>
        `).join('');
    }
    renderReservasFuturas();
}

function abrirModalReserva() {
    limpiarFormularioReserva();
    const modal = document.getElementById('modal-reserva');
    if (modal) modal.classList.add('show');
}

function cerrarModalReserva() {
    const modal = document.getElementById('modal-reserva');
    if (modal) modal.classList.remove('show');
}

function abrirModalSolicitud() {
    const modal = document.getElementById('modal-solicitud');
    if (modal) modal.classList.add('show');
}

function cerrarModalSolicitud() {
    const modal = document.getElementById('modal-solicitud');
    if (modal) modal.classList.remove('show');
}

function guardarReserva(event) {
    event.preventDefault();
    const fecha = document.getElementById('reserva-fecha').value;
    const hora = document.getElementById('reserva-hora').value;
    const cliente = document.getElementById('reserva-cliente').value.trim().toUpperCase();
    const tipo = document.getElementById('reserva-tipo').value.trim();
    const moto = document.getElementById('reserva-moto')?.value.trim() || '';
    const abono = document.getElementById('reserva-abono').value.trim();
    const soporteFile = document.getElementById('reserva-soporte').files?.[0];
    const editId = document.getElementById('form-reserva').dataset.editId || '';
    if (!fecha || !hora || !cliente || !tipo) return mostrarAlerta('DATOS INCOMPLETOS', 'Completa fecha, hora, cliente y tipo.');
    const guardar = soporte => {
        const previa = obtenerReserva(editId);
        const payload = {
            id: editId || `res-${Date.now()}`,
            fecha,
            hora,
            cliente,
            tipo,
            abono,
            moto,
            estado: previa?.estado || 'PENDIENTE',
            soporte: soporte || previa?.soporte || null,
            contratoCodigo: previa?.contratoCodigo || '',
            cargadaContrato: Boolean(previa?.cargadaContrato),
            creadoPor: previa?.creadoPor || obtenerNombreTrabajadorActual(),
            fechaCreacion: previa?.fechaCreacion || obtenerFechaHoraActual()
        };
        if (editId) {
            const idx = dashboardData.reservas.findIndex(item => item.id === editId);
            if (idx >= 0) dashboardData.reservas[idx] = payload;
        } else {
            dashboardData.reservas.push(payload);
        }
        persistirDashboard();
        limpiarFormularioReserva();
        cerrarModalReserva();
        reservasPaginaActual = 1;
        renderDashboard();
        verReciboReserva(payload.id);
    };
    if (soporteFile) leerArchivo(soporteFile, `ABONO-${normalizarTextoArchivo(cliente)}.${obtenerExtension(soporteFile)}`, guardar);
    else guardar(null);
}

function obtenerReserva(id) { return dashboardData.reservas.find(item => item.id === id); }

function editarReserva(id) {
    const reserva = obtenerReserva(id);
    if (!reserva) return;
    document.getElementById('modal-reserva-titulo').innerText = 'Editar reserva';
    document.getElementById('reserva-fecha').value = reserva.fecha;
    document.getElementById('reserva-hora').value = reserva.hora;
    document.getElementById('reserva-cliente').value = reserva.cliente;
    document.getElementById('reserva-tipo').value = reserva.tipo;
    const motoCampo = document.getElementById('reserva-moto');
    if (motoCampo) motoCampo.value = reserva.moto || '';
    document.getElementById('reserva-abono').value = reserva.abono || '';
    document.getElementById('form-reserva').dataset.editId = reserva.id;
    const modal = document.getElementById('modal-reserva');
    if (modal) modal.classList.add('show');
}

function limpiarFormularioReserva() {
    const form = document.getElementById('form-reserva');
    if (!form) return;
    form.reset();
    document.getElementById('reserva-fecha').value = obtenerFechaHoy();
    document.getElementById('modal-reserva-titulo').innerText = 'Crear reserva';
    form.dataset.editId = '';
}

function eliminarReserva(id) {
    dashboardData.reservas = dashboardData.reservas.filter(item => item.id !== id);
    persistirDashboard();
    renderDashboard();
}

function obtenerNombreTrabajadorActual() {
    return adminAutenticado ? 'ADMINISTRADOR' : 'ASESORA';
}

function construirTextoReciboReserva(reserva) {
    return [
        'RODEMOS INVERGROUP',
        `Recibo de reserva ${reserva.id}`,
        `Cliente: ${reserva.cliente}`,
        `Fecha reserva: ${reserva.fecha} ${reserva.hora}`,
        `Tipo: ${reserva.tipo}`,
        `Abono: ${reserva.abono || '0'}`,
        `Registrado por: ${reserva.creadoPor || 'ASESORA'}`,
        `Creado: ${reserva.fechaCreacion || obtenerFechaHoraActual()}`
    ].join('\n');
}

function construirHtmlReciboReserva(reserva) {
    return `
        <table class="excel-table">
            <tbody>
                <tr><th colspan="2">RODEMOS INVERGROUP</th></tr>
                <tr><td>Recibo</td><td>${reserva.id}</td></tr>
                <tr><td>Cliente</td><td>${reserva.cliente}</td></tr>
                <tr><td>Fecha reserva</td><td>${reserva.fecha} ${reserva.hora}</td></tr>
                <tr><td>Tipo</td><td>${reserva.tipo}</td></tr>
                <tr><td>Abono</td><td>${reserva.abono || '0'}</td></tr>
                <tr><td>Registrado por</td><td>${reserva.creadoPor || 'ASESORA'}</td></tr>
                <tr><td>Creado</td><td>${reserva.fechaCreacion || obtenerFechaHoraActual()}</td></tr>
            </tbody>
        </table>
    `;
}

function verReciboReserva(id) {
    const reserva = obtenerReserva(id);
    const contenedor = document.getElementById('recibo-reserva-preview');
    if (!reserva || !contenedor) return;
    contenedor.dataset.texto = construirTextoReciboReserva(reserva);
    contenedor.innerHTML = construirHtmlReciboReserva(reserva);
    document.getElementById('modal-recibo-reserva')?.classList.add('show');
}

function cerrarModalReciboReserva() {
    document.getElementById('modal-recibo-reserva')?.classList.remove('show');
}

async function copiarTextoReciboReserva() {
    const contenedor = document.getElementById('recibo-reserva-preview');
    const texto = contenedor?.dataset.texto || '';
    if (!texto) return;
    try {
        await navigator.clipboard.writeText(texto);
        mostrarAlerta('RECIBO COPIADO', 'El texto del recibo quedo listo para pegarlo en WhatsApp.');
    } catch {
        mostrarAlerta('COPIA MANUAL', texto);
    }
}

function obtenerReservasFuturas() {
    return [...dashboardData.reservas].filter(item => item.fecha >= obtenerFechaHoy()).sort((a, b) => `${a.fecha} ${a.hora}`.localeCompare(`${b.fecha} ${b.hora}`));
}

function renderReservasFuturas() {
    const body = document.getElementById('reservas-futuras-body');
    const paginacion = document.getElementById('reservas-paginacion');
    if (!body || !paginacion) return;
    const reservas = obtenerReservasFuturas();
    if (!reservas.length) {
        body.innerHTML = '<tr><td colspan="7" class="dashboard-empty">No hay reservas futuras registradas.</td></tr>';
        paginacion.innerHTML = '';
        return;
    }
    const porPagina = 5;
    const total = Math.ceil(reservas.length / porPagina);
    reservasPaginaActual = Math.min(Math.max(reservasPaginaActual, 1), total);
    const pagina = reservas.slice((reservasPaginaActual - 1) * porPagina, reservasPaginaActual * porPagina);
    body.innerHTML = pagina.map(item => `
        <tr>
            <td>${item.fecha}</td>
            <td>${item.hora}</td>
            <td>${item.cliente}</td>
            <td>${item.tipo}</td>
            <td>${item.abono || '-'}</td>
            <td>${item.contratoCodigo || '-'}</td>
            <td>${item.soporte?.fileName ? `<button class="btn-icon" onclick="abrirArchivo(${JSON.stringify(item.soporte).replace(/"/g, '&quot;')})">Ver</button>` : '-'}</td>
            <td>
                <div class="doc-actions">
                    <button class="btn-icon" onclick="editarReserva('${item.id}')">Editar</button>
                    <button class="btn-icon" onclick="eliminarReserva('${item.id}')">Eliminar</button>
                    <button class="btn-icon" onclick="verReciboReserva('${item.id}')">Recibo</button>
                </div>
            </td>
        </tr>
    `).join('');
    paginacion.innerHTML = `
        <button class="btn-icon" onclick="cambiarPaginaReservas(-1)" ${reservasPaginaActual === 1 ? 'disabled' : ''}>Anterior</button>
        <span class="dashboard-page-label">Pagina ${reservasPaginaActual} de ${total}</span>
        <button class="btn-icon" onclick="cambiarPaginaReservas(1)" ${reservasPaginaActual === total ? 'disabled' : ''}>Siguiente</button>
    `;
}

function cambiarPaginaReservas(delta) {
    reservasPaginaActual += delta;
    renderReservasFuturas();
}

function renderTareas() {
    const contenedor = document.getElementById('tareas-lista');
    if (!contenedor) return;
    if (!dashboardData.tareas.length) {
        contenedor.innerHTML = '<div class="dashboard-empty">No hay tareas registradas.</div>';
        return;
    }
    contenedor.innerHTML = dashboardData.tareas.map(item => `
        <div class="dashboard-thread">
            <strong>${item.titulo}</strong>
            <small>${item.estado} · ${item.fecha || ''}</small>
        </div>
    `).join('');
}

function crearTareaAdmin(event) {
    event.preventDefault();
    const titulo = document.getElementById('admin-tarea').value.trim();
    if (!titulo) return mostrarAlerta('TAREA VACIA', 'Escribe una tarea para la asesora.');
    dashboardData.tareas.push({ id: `tar-${Date.now()}`, titulo, origen: 'admin', estado: 'pendiente', fecha: obtenerFechaHoraActual() });
    persistirDashboard();
    document.getElementById('form-tarea-admin').reset();
    renderDashboard();
}

async function crearSolicitud(event) {
    event.preventDefault();
    const asunto = document.getElementById('solicitud-asunto').value.trim().toUpperCase();
    const mensaje = document.getElementById('solicitud-mensaje').value.trim();
    const cliente = document.getElementById('solicitud-cliente').value.trim();
    const contratoCodigo = document.getElementById('solicitud-contrato').value.trim();
    const proceso = document.getElementById('solicitud-proceso').value;
    const imagenFile = document.getElementById('solicitud-imagen').files?.[0];
    if (!asunto || !mensaje) return mostrarAlerta('SOLICITUD INCOMPLETA', 'Escribe asunto y mensaje.');
    let imagen = null;
    if (imagenFile) imagen = await leerArchivoComoDocumento(imagenFile, `SOLICITUD-${Date.now()}.${obtenerExtension(imagenFile)}`);
    const fecha = obtenerFechaHoraActual();
    const solicitud = {
        id: `sol-${Date.now()}`,
        asunto,
        estado: 'abierta',
        carpeta: 'principal',
        cliente,
        contratoCodigo,
        proceso,
        cerradoPor: '',
        abiertoPor: '',
        unreadAsesora: 0,
        unreadAdmin: 1,
        ultimaActividad: fecha,
        mensajes: [{ autor: 'asesora', texto: mensaje, fecha, imagen }]
    };
    dashboardData.solicitudes.unshift(solicitud);
    persistirDashboard();
    document.getElementById('form-solicitud-asesora').reset();
    actualizarContratosSolicitud();
    cerrarModalSolicitud();
    solicitudFolderActual = 'principal';
    solicitudSeleccionadaId = solicitud.id;
    renderDashboard();
}

function obtenerSolicitudesFiltradas(esAdmin) {
    const busqueda = normalizarBusqueda(document.getElementById(esAdmin ? 'config-solicitudes-busqueda' : 'solicitudes-busqueda')?.value || '');
    const tokens = busqueda.split(/\s+/).filter(Boolean);
    return dashboardData.solicitudes
        .filter(item => (solicitudFolderActual === 'cerrados' ? item.carpeta === 'cerrados' : item.carpeta !== 'cerrados'))
        .filter(item => {
            if (!tokens.length) return true;
            const texto = normalizarBusqueda(`${item.asunto} ${item.cliente} ${item.contratoCodigo} ${item.proceso} ${(item.mensajes[item.mensajes.length - 1]?.texto || '')}`);
            return tokens.every(token => texto.includes(token));
        })
        .sort((a, b) => {
            const unreadA = esAdmin ? Number(b.unreadAdmin || 0) - Number(a.unreadAdmin || 0) : Number(b.unreadAsesora || 0) - Number(a.unreadAsesora || 0);
            if (unreadA) return unreadA;
            return String(b.ultimaActividad || '').localeCompare(String(a.ultimaActividad || ''));
        });
}

function renderSolicitudes(esAdmin) {
    const lista = document.getElementById(esAdmin ? 'config-solicitudes-lista' : 'solicitudes-lista');
    const detalle = document.getElementById(esAdmin ? 'config-solicitud-detalle' : 'solicitud-detalle');
    if (!lista || !detalle) return;
    const solicitudes = obtenerSolicitudesFiltradas(esAdmin);
    const btnPrincipal = document.getElementById('btn-folder-principal');
    const btnCerrados = document.getElementById('btn-folder-cerrados');
    if (btnPrincipal) btnPrincipal.classList.toggle('active', solicitudFolderActual !== 'cerrados');
    if (btnCerrados) btnCerrados.classList.toggle('active', solicitudFolderActual === 'cerrados');
    if (!solicitudes.length) {
        lista.innerHTML = '<div class="dashboard-empty">No hay solicitudes registradas.</div>';
        detalle.innerHTML = 'Selecciona una solicitud para ver el historial.';
        return;
    }
    if (!solicitudes.some(item => item.id === solicitudSeleccionadaId)) solicitudSeleccionadaId = solicitudes[0].id;
    lista.innerHTML = solicitudes.map(item => `
        <button class="dashboard-thread ${item.id === solicitudSeleccionadaId ? 'active' : ''}" onclick="seleccionarSolicitud('${item.id}', '${esAdmin ? 'admin' : 'asesora'}'); renderSolicitudes(${esAdmin})">
            <div class="dashboard-thread-top">
                <strong>${item.asunto}</strong>
                <span class="chat-status-badge ${item.estado === 'cerrada' ? 'closed' : 'open'}">${item.estado === 'cerrada' ? 'Cerrado' : 'Abierto'}</span>
            </div>
            <small>${item.cliente || 'Sin cliente'}${item.contratoCodigo ? ` · ${item.contratoCodigo}` : ''}${item.proceso ? ` · ${item.proceso}` : ''}</small>
            <small>${item.mensajes[item.mensajes.length - 1]?.texto || ''}</small>
            <div class="dashboard-thread-meta">
                <small>${item.mensajes[item.mensajes.length - 1]?.fecha || ''}</small>
                ${(!esAdmin && item.unreadAsesora) ? `<span class="chat-unread-badge">${item.unreadAsesora}</span>` : ''}
                ${(esAdmin && item.unreadAdmin) ? `<span class="chat-unread-badge">${item.unreadAdmin}</span>` : ''}
            </div>
        </button>
    `).join('');
    const solicitud = dashboardData.solicitudes.find(item => item.id === solicitudSeleccionadaId);
    if (!solicitud) return detalle.innerHTML = 'Selecciona una solicitud para ver el historial.';
    if (solicitudLecturaActiva && solicitudLecturaActor === (esAdmin ? 'admin' : 'asesora')) {
        if (esAdmin) solicitud.unreadAdmin = 0;
        else solicitud.unreadAsesora = 0;
    }
    persistirDashboard();
    detalle.innerHTML = `
        <div class="dashboard-chat-header">
            <div>
                <strong>${solicitud.asunto}</strong>
                <small>${solicitud.cliente || 'Sin cliente'}${solicitud.contratoCodigo ? ` · ${solicitud.contratoCodigo}` : ''}${solicitud.proceso ? ` · ${solicitud.proceso}` : ''}</small>
            </div>
            <div class="doc-actions">
                <button class="btn-icon chat-status-badge ${solicitud.estado === 'cerrada' ? 'closed' : 'open'}" onclick="cambiarEstadoSolicitud('${solicitud.id}', '${esAdmin ? 'admin' : 'asesora'}')">${solicitud.estado === 'cerrada' ? 'Reabrir' : 'Cerrar'}</button>
            </div>
        </div>
        <div class="dashboard-chat-history">
            ${solicitud.mensajes.map(msg => `
                <div class="dashboard-bubble ${msg.autor === (esAdmin ? 'admin' : 'asesora') ? 'mine' : 'theirs'} ${msg.autor === 'admin' ? 'admin' : 'asesora'}">
                    <div class="dashboard-bubble-line">
                        <p>${msg.texto}</p>
                        <small class="dashboard-bubble-time">${msg.fecha}</small>
                    </div>
                    ${msg.imagen?.dataUrl ? `<img src="${msg.imagen.dataUrl}" class="dashboard-chat-image" alt="Adjunto">` : ''}
                </div>
            `).join('')}
            ${solicitud.estado === 'cerrada' && solicitud.cerradoPor ? `<div class="dashboard-empty">Cerrado por ${solicitud.cerradoPor}</div>` : ''}
            ${solicitud.abiertoPor ? `<div class="dashboard-empty">Reabierto por ${solicitud.abiertoPor}</div>` : ''}
        </div>
    `;
}

function seleccionarSolicitud(id, actor = 'asesora') {
    solicitudSeleccionadaId = id;
    solicitudLecturaActiva = true;
    solicitudLecturaActor = actor;
}

function seleccionarCarpetaSolicitudes(carpeta) {
    solicitudFolderActual = carpeta;
    renderSolicitudes(false);
    renderSolicitudes(true);
}

function poblarClientesSolicitud() {
    const lista = document.getElementById('solicitud-clientes-lista');
    if (!lista) return;
    lista.innerHTML = dbClientes.map(cliente => `<option value="${cliente.nombre} | ${cliente.doc}"></option>`).join('');
}

function actualizarContratosSolicitud() {
    const select = document.getElementById('solicitud-contrato');
    const cliente = document.getElementById('solicitud-cliente')?.value || '';
    if (!select) return;
    const doc = cliente.includes('|') ? cliente.split('|')[1].trim() : '';
    const contratos = doc ? obtenerContratosIniciales().filter(c => (c.arrendatario1 || '').includes(doc) || (c.arrendatario2 || '').includes(doc)) : [];
    select.innerHTML = `<option value="">Sin contrato asociado</option>${contratos.map(c => `<option value="${c.codigo}">${c.codigo} · ${c.estado}</option>`).join('')}`;
}

async function responderSolicitud(event, autor) {
    event.preventDefault();
    const inputId = autor === 'admin' ? 'respuesta-admin' : 'respuesta-asesora';
    const input = document.getElementById(inputId);
    const texto = input.value.trim();
    const imagenInput = document.getElementById(autor === 'admin' ? 'respuesta-admin-imagen' : 'respuesta-asesora-imagen');
    const solicitud = dashboardData.solicitudes.find(item => item.id === solicitudSeleccionadaId);
    if (!texto || !solicitud) return;
    let imagen = null;
    const file = imagenInput?.files?.[0];
    if (file) imagen = await leerArchivoComoDocumento(file, `CHAT-${Date.now()}.${obtenerExtension(file)}`);
    solicitud.mensajes.push({ autor, texto, fecha: obtenerFechaHoraActual(), imagen });
    solicitud.ultimaActividad = obtenerFechaHoraActual();
    if (autor === 'admin') {
        solicitud.unreadAsesora = Number(solicitud.unreadAsesora || 0) + 1;
        solicitud.unreadAdmin = 0;
    } else {
        solicitud.unreadAdmin = Number(solicitud.unreadAdmin || 0) + 1;
        solicitud.unreadAsesora = 0;
    }
    if (solicitud.estado === 'cerrada') {
        solicitud.estado = 'abierta';
        solicitud.carpeta = 'principal';
        solicitud.abiertoPor = autor;
    }
    persistirDashboard();
    input.value = '';
    if (imagenInput) imagenInput.value = '';
    renderSolicitudes(false);
    renderSolicitudes(true);
    renderResumenDashboard();
}

function cambiarEstadoSolicitud(id, actor) {
    const solicitud = dashboardData.solicitudes.find(item => item.id === id);
    if (!solicitud) return;
    if (solicitud.estado === 'cerrada') {
        solicitud.estado = 'abierta';
        solicitud.carpeta = 'principal';
        solicitud.abiertoPor = actor;
        solicitud.cerradoPor = '';
    } else {
        solicitud.estado = 'cerrada';
        solicitud.carpeta = 'cerrados';
        solicitud.cerradoPor = actor;
    }
    solicitud.ultimaActividad = obtenerFechaHoraActual();
    persistirDashboard();
    renderSolicitudes(true);
    renderSolicitudes(false);
    renderResumenDashboard();
}

function inicializarMotos() {
    motoSeleccionadaIdx = null;
    limpiarFormularioMoto();
    document.getElementById('detalle-moto').style.display = 'none';
    ocultarBusqueda('area-coincidencias-motos', 'btn-principal-crear-moto');
}

function limpiarFormularioMoto() {
    ['placa', 'busqueda', 'marca', 'referencia', 'modelo', 'cilindraje', 'motor', 'chasis', 'color', 'soat', 'tecno'].forEach(f => {
        const el = document.getElementById('mo-' + f);
        if (el) el.value = '';
    });
    const alerta = document.getElementById('alerta-documentos-moto');
    if (alerta) alerta.style.display = 'none';
}

function buscarMotos() {
    const placa = document.getElementById('mo-placa').value.toUpperCase().trim();
    const texto = document.getElementById('mo-busqueda').value.toUpperCase().trim();
    const area = document.getElementById('area-coincidencias-motos');
    const lista = document.getElementById('lista-resultados-motos');
    const btnCrear = document.getElementById('btn-principal-crear-moto');
    const creando = document.getElementById('detalle-moto')?.style.display === 'block' && motoSeleccionadaIdx === null;
    if (!placa && !texto) return ocultarBusqueda('area-coincidencias-motos', 'btn-principal-crear-moto');
    const filtrados = dbMotos.filter(m => (placa && String(m.placa).includes(placa)) || (texto && `${m.marca || ''} ${m.referencia || ''}`.includes(texto)));
    if (filtrados.length) {
        area.style.display = 'block';
        btnCrear.style.display = 'none';
        lista.innerHTML = filtrados.map(m => `<div class="doc-item" style="margin-bottom:8px"><div><strong>${m.placa}</strong> <small>${m.marca || ''} ${m.referencia || ''}</small></div><button onclick="verDetalleMoto(${dbMotos.indexOf(m)})" class="btn-listado" style="padding:5px 15px">Ver</button></div>`).join('');
    } else {
        area.style.display = 'none';
        btnCrear.style.display = creando ? 'none' : 'block';
    }
}

function mostrarFormularioMotoNueva() {
    const placa = document.getElementById('mo-placa').value.toUpperCase().trim();
    motoSeleccionadaIdx = null;
    limpiarFormularioMoto();
    document.getElementById('mo-placa').value = placa;
    document.getElementById('detalle-moto').style.display = 'block';
    document.getElementById('btn-principal-crear-moto').style.display = 'none';
}

function verDetalleMoto(idx) {
    motoSeleccionadaIdx = idx;
    const m = dbMotos[idx];
    document.getElementById('detalle-moto').style.display = 'block';
    ocultarBusqueda('area-coincidencias-motos', 'btn-principal-crear-moto');
    ['placa', 'marca', 'referencia', 'modelo', 'cilindraje', 'motor', 'chasis', 'color', 'soat', 'tecno'].forEach(f => {
        const key = f === 'soat' ? 'vencimientoSoat' : f === 'tecno' ? 'vencimientoTecno' : f;
        document.getElementById('mo-' + f).value = m[key] || '';
    });
    actualizarAlertaMoto(m);
}

function construirMotoDesdeFormulario() {
    return {
        placa: document.getElementById('mo-placa').value.toUpperCase().trim(),
        marca: document.getElementById('mo-marca').value.toUpperCase().trim(),
        referencia: document.getElementById('mo-referencia').value.toUpperCase().trim(),
        modelo: document.getElementById('mo-modelo').value.trim(),
        cilindraje: document.getElementById('mo-cilindraje').value.trim(),
        motor: document.getElementById('mo-motor').value.trim(),
        chasis: document.getElementById('mo-chasis').value.trim(),
        color: document.getElementById('mo-color').value.toUpperCase().trim(),
        vencimientoSoat: document.getElementById('mo-soat').value,
        vencimientoTecno: document.getElementById('mo-tecno').value
    };
}

async function exportarCarpetaMoto(moto, motoPrevio = null) {
    if (!window.showDirectoryPicker) return moto;
    try {
        const baseDir = await obtenerSubcarpetaBase('motos');
        if (!baseDir) return moto;
        const nombreCarpetaNueva = normalizarTextoArchivo(moto.placa || moto.referencia || 'MOTO');
        const nombreCarpetaAnterior = motoPrevio?.storageFolderName || null;
        const carpetaMoto = await baseDir.getDirectoryHandle(nombreCarpetaNueva, { create: true });
        if (nombreCarpetaAnterior && nombreCarpetaAnterior !== nombreCarpetaNueva) await limpiarCarpetaAnterior(baseDir, nombreCarpetaAnterior);
        await escribirArchivoTexto(carpetaMoto, 'FICHA-MOTO.txt', [
            `PLACA: ${moto.placa || ''}`,
            `MARCA: ${moto.marca || ''}`,
            `REFERENCIA: ${moto.referencia || ''}`,
            `LINEA: ${moto.linea || ''}`,
            `CLASE: ${moto.clase || ''}`,
            `MODELO: ${moto.modelo || ''}`,
            `CILINDRAJE: ${moto.cilindraje || ''}`,
            `COLOR: ${moto.color || ''}`,
            `MOTOR: ${moto.motor || ''}`,
            `CHASIS: ${moto.chasis || ''}`,
            `VENCE TECNOMECANICA: ${moto.vencimientoTecno || ''}`,
            `VENCE SOAT: ${moto.vencimientoSoat || ''}`
        ].join('\n'));
        const archivosActuales = ['FICHA-MOTO.txt'];
        for (const archivo of Object.values(moto.fotos || {})) {
            if (archivo?.dataUrl) {
                await escribirArchivoBinario(carpetaMoto, archivo);
                archivosActuales.push(archivo.fileName);
            }
        }
        const previos = motoPrevio?.archivosGuardados || [];
        for (const nombre of previos.filter(nombre => !archivosActuales.includes(nombre))) await eliminarArchivoSiExiste(carpetaMoto, nombre);
        return { ...moto, storageFolderName: nombreCarpetaNueva, archivosGuardados: archivosActuales };
    } catch (error) {
        console.error(error);
        mostrarAlerta('NO SE PUDO EXPORTAR', 'La moto quedo guardada en la app, pero no fue posible escribir la carpeta.');
        return moto;
    }
}

async function guardarMoto() {
    let moto = construirMotoDesdeFormulario();
    if (!moto.placa) return mostrarAlerta('PLACA REQUERIDA', 'La placa es obligatoria.');
    const duplicada = dbMotos.findIndex(m => m.placa === moto.placa);
    if (duplicada >= 0 && duplicada !== motoSeleccionadaIdx) return mostrarAlerta('PLACA DUPLICADA', `La placa ${moto.placa} ya existe.`);
    const previo = motoSeleccionadaIdx === null ? null : dbMotos[motoSeleccionadaIdx];
    moto = await exportarCarpetaMoto(moto, previo);
    if (motoSeleccionadaIdx === null) dbMotos.push(moto);
    else dbMotos[motoSeleccionadaIdx] = moto;
    persistirMotos();
    loadPage('motos').then(() => mostrarAlerta('PROCESO COMPLETADO', 'Moto guardada correctamente.'));
}

function estadoDocumentalMoto(moto) {
    const hoy = obtenerFechaHoy();
    const vencidas = [];
    if (moto.vencimientoSoat && moto.vencimientoSoat < hoy) vencidas.push('SOAT vencido');
    if (moto.vencimientoTecno && moto.vencimientoTecno < hoy) vencidas.push('Tecnicomecanica vencida');
    return vencidas.length ? vencidas.join(' / ') : 'AL DIA';
}

function actualizarAlertaMoto(moto) {
    const alerta = document.getElementById('alerta-documentos-moto');
    if (!alerta) return;
    const estado = estadoDocumentalMoto(moto);
    alerta.style.display = 'block';
    alerta.innerText = estado === 'AL DIA' ? 'Documentos al dia.' : estado;
    alerta.className = `mini-alert ${estado === 'AL DIA' ? 'ok' : 'warn'}`;
}

function abrirListadoMotos() {
    const tabla = document.getElementById('tabla-motos-body');
    if (!tabla) return;
    tabla.innerHTML = dbMotos.map(m => `<tr><td><b>${m.placa}</b></td><td>${m.marca || '-'}</td><td>${m.referencia || '-'}</td><td>${m.modelo || '-'}</td><td>${estadoDocumentalMoto(m)}</td><td><button class="btn-listado" style="padding:2px 10px" onclick="cerrarModales(); verDetalleMoto(${dbMotos.indexOf(m)})">Ver</button></td></tr>`).join('');
    document.getElementById('modal-listado-motos').classList.add('show');
}

function inicializarContratos() {
    inicializarFuelScale();
    inicializarMoneyInputsContrato();
    inicializarFechaDevolucionContrato();
    limpiarFormularioContrato();
    limpiarFormularioCambioContrato();
    renderListaContratos();
    seleccionarModoContrato(contratoModoActual || 'NUEVO');
}

function seleccionarModoContrato(modo) {
    contratoModoActual = modo;
    ['NUEVO', 'CAMBIO', 'FINALIZACION', 'HISTORIAL'].forEach(item => {
        const btn = document.getElementById(`btn-mode-${item.toLowerCase()}`);
        if (btn) btn.classList.toggle('active', item === modo);
    });
    ['nuevo', 'cambio', 'finalizacion'].forEach(item => {
        const panel = document.getElementById(`contrato-panel-${item}`);
        if (panel) panel.style.display = item.toUpperCase() === modo ? 'block' : 'none';
    });
    const panelHistorial = document.getElementById('contrato-historial-panel');
    if (panelHistorial) panelHistorial.style.display = modo === 'HISTORIAL' ? 'block' : 'none';
    const detalleHistorial = document.getElementById('detalle-historial-contrato');
    if (detalleHistorial) {
        if (modo !== 'HISTORIAL') {
            detalleHistorial.style.display = 'none';
            detalleHistorial.innerHTML = '';
        }
    }
    const estadoInput = document.getElementById('con-estado');
    if (estadoInput) estadoInput.value = 'ACTIVO';
    if (modo === 'NUEVO' && !document.getElementById('con-codigo')?.value) limpiarFormularioContrato();
    if (modo === 'CAMBIO') limpiarFormularioCambioContrato();
    if (modo === 'HISTORIAL') renderListaContratos();
}

function irHistorialContratos() {
    seleccionarModoContrato('HISTORIAL');
}

function generarCodigoContrato() {
    if (document.getElementById('con-codigo')?.value) return;
    const codigo = `CTR-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    const input = document.getElementById('con-codigo');
    if (input) input.value = codigo;
    const visual = document.getElementById('con-codigo-visual');
    if (visual) visual.innerText = codigo;
    const btn = document.getElementById('btn-generar-codigo');
    if (btn) {
        btn.disabled = true;
        btn.classList.add('is-disabled');
    }
    habilitarFlujoContrato();
}

function limpiarFormularioContrato() {
    detenerRelojContrato();
    contratoUltimoCreado = null;
    contratoPagosTemp = crearEstadoPagosContrato();
    ['codigo', 'arrendatario-1', 'arrendatario-2', 'moto', 'valor', 'observaciones', 'hora-creacion', 'fecha-devolucion', 'novedades-entrega'].forEach(campo => {
        const el = document.getElementById(`con-${campo}`);
        if (el) el.value = '';
    });
    const tipoContrato = document.getElementById('con-tipo-contrato');
    if (tipoContrato) tipoContrato.value = 'CORTO';
    const fecha = document.getElementById('con-fecha-inicio');
    if (fecha) fecha.value = '';
    const indefinida = document.getElementById('con-fecha-indefinida');
    if (indefinida) indefinida.checked = false;
    const alerta = document.getElementById('alerta-docs-contrato');
    if (alerta) alerta.style.display = 'none';
    const visual = document.getElementById('con-codigo-visual');
    if (visual) visual.innerText = 'SIN GENERAR';
    const btn = document.getElementById('btn-generar-codigo');
    if (btn) {
        btn.disabled = false;
        btn.classList.remove('is-disabled');
    }
    const imprimir = document.getElementById('btn-imprimir-contrato');
    if (imprimir) imprimir.disabled = true;
    setEntregaItem('llaves', true);
    setEntregaItem('matricula', true);
    setFuelLevel(0);
    sincronizarFechaDevolucionContrato(true);
    setMoneyText('con-abono-reserva', 0);
    setMoneyText('con-total-pagado-visual', 0);
    setMoneyText('con-saldo-pendiente-visual', 0);
    setMoneyText('con-deposito-pagado-visual', 0);
    setMoneyText('con-deposito-saldo-visual', 0);
    setMoneyText('con-total-general-pagos-visual', 0);
    renderResumenPagosContrato();
    actualizarEstadoPasosContrato(false, false);
}

function habilitarFlujoContrato() {
    const fecha = document.getElementById('con-fecha-inicio');
    const hora = document.getElementById('con-hora-creacion');
    if (fecha) fecha.value = obtenerFechaHoy();
    if (hora) hora.value = '';
    const visual = document.getElementById('con-codigo-visual');
    const codigo = document.getElementById('con-codigo')?.value || '';
    if (visual) visual.innerText = codigo || 'SIN GENERAR';
    actualizarEstadoPasosContrato(true, false);
    iniciarRelojContrato();
}

function actualizarEstadoPasosContrato(arrendatariosHabilitados, detallesHabilitados) {
    const stepArr = document.getElementById('con-step-arrendatarios');
    const stepDet = document.getElementById('con-step-detalles');
    if (stepArr) stepArr.classList.toggle('contract-step-disabled', !arrendatariosHabilitados);
    if (stepDet) stepDet.classList.toggle('contract-step-disabled', !detallesHabilitados);
    ['con-btn-arr1', 'con-btn-arr2'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = !arrendatariosHabilitados;
    });
    ['con-btn-moto', 'btn-guardar-contrato', 'btn-generar-pdf', 'con-valor', 'con-tipo-contrato', 'con-observaciones', 'con-devolucion-dia', 'con-devolucion-mes', 'con-fecha-indefinida', 'con-novedades-entrega', 'btn-revisar-reserva', 'btn-abrir-pagos'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = !detallesHabilitados;
    });
    if (!detallesHabilitados) {
        toggleFechaDevolucionIndefinida(document.getElementById('con-fecha-indefinida')?.checked);
    }
}

function revisarHabilitacionDetallesContrato() {
    const arr1 = document.getElementById('con-arrendatario-1')?.value.trim();
    const habilitar = Boolean(arr1);
    actualizarEstadoPasosContrato(true, habilitar);
}

function abrirSelectorEntidad(tipo, destino) {
    selectorActual = { tipo, destino };
    const titulos = {
        arrendatario1: 'Seleccionar arrendatario 1',
        arrendatario2: 'Seleccionar arrendatario 2',
        moto: 'Seleccionar moto',
        reporteCliente: 'Seleccionar cliente',
        cambioCliente: 'Buscar cliente para cambio',
        cambioMoto: 'Seleccionar moto nueva'
    };
    document.getElementById('selector-titulo').innerText = titulos[destino] || (tipo === 'cliente' ? 'Seleccionar cliente' : 'Seleccionar moto');
    document.getElementById('selector-busqueda').value = '';
    document.getElementById('modal-selector-global').classList.add('show');
    renderSelectorEntidad();
}

function cerrarSelectorEntidad() {
    document.getElementById('modal-selector-global').classList.remove('show');
    selectorActual = null;
}

function renderSelectorEntidad() {
    if (!selectorActual) return;
    const q = normalizarBusqueda(document.getElementById('selector-busqueda').value);
    const tokens = q.split(/\s+/).filter(Boolean);
    const resultados = selectorActual.tipo === 'cliente'
        ? dbClientes.filter(c => {
            if (!q) return true;
            const nombre = normalizarBusqueda(c.nombre);
            const doc = String(c.doc || '');
            return doc.includes(q) || tokens.every(token => nombre.includes(token));
        })
        : dbMotos.filter(m => {
            if (!q) return true;
            const textoMoto = normalizarBusqueda(`${m.placa || ''} ${m.marca || ''} ${m.referencia || ''}`);
            return tokens.every(token => textoMoto.includes(token));
        });
    const contenedor = document.getElementById('selector-resultados');
    if (!resultados.length) {
        contenedor.innerHTML = '<div class="dashboard-empty">Sin coincidencias.</div>';
        return;
    }
    contenedor.innerHTML = resultados.map(item => {
        const texto = selectorActual.tipo === 'cliente' ? `${item.nombre} · CC ${item.doc}` : `${item.placa} · ${item.marca || ''} ${item.referencia || ''}`;
        return `<div class="dashboard-item"><div><strong>${texto}</strong><small>${selectorActual.tipo === 'moto' ? estadoDocumentalMoto(item) : (item.email || item.tel || '')}</small></div><button class="btn-listado" onclick="prepararConfirmacionSeleccion('${selectorActual.tipo}', '${selectorActual.destino}', '${item.id || item.doc || item.placa}')">Seleccionar</button></div>`;
    }).join('');
}

function prepararConfirmacionSeleccion(tipo, destino, id) {
    seleccionPendiente = { tipo, destino, id };
    let texto = '';
    let titulo = 'Confirmar seleccion';
    if (tipo === 'cliente') {
        const cliente = dbClientes.find(c => String(c.doc) === String(id));
        if (!cliente) return;
        titulo = destino === 'arrendatario1' ? 'Confirmar arrendatario 1' : destino === 'arrendatario2' ? 'Confirmar arrendatario 2' : destino === 'cambioCliente' ? 'Confirmar cliente del cambio' : 'Confirmar cliente';
        texto = `${cliente.nombre} - CC ${cliente.doc}`;
    } else {
        const moto = dbMotos.find(m => String(m.placa) === String(id));
        if (!moto) return;
        titulo = destino === 'cambioMoto' ? 'Confirmar moto nueva' : 'Confirmar moto';
        texto = `${moto.placa} - ${moto.marca || ''} ${moto.referencia || ''}`.trim();
    }
    document.getElementById('confirmacion-titulo').innerText = titulo;
    document.getElementById('confirmacion-texto').innerText = texto;
    document.getElementById('modal-confirmacion-seleccion').classList.add('show');
}

function cerrarConfirmacionSeleccion() {
    document.getElementById('modal-confirmacion-seleccion').classList.remove('show');
    seleccionPendiente = null;
}

function confirmarSeleccionPendiente() {
    if (!seleccionPendiente) return;
    const { tipo, destino, id } = seleccionPendiente;
    cerrarConfirmacionSeleccion();
    confirmarSeleccionEntidad(tipo, destino, id);
}

function confirmarSeleccionEntidad(tipo, destino, id) {
    if (tipo === 'cliente') {
        const cliente = dbClientes.find(c => String(c.doc) === String(id));
        if (!cliente) return;
        if (destino === 'arrendatario1') document.getElementById('con-arrendatario-1').value = `${cliente.nombre} | ${cliente.doc}`;
        if (destino === 'arrendatario2') document.getElementById('con-arrendatario-2').value = `${cliente.nombre} | ${cliente.doc}`;
        if (destino === 'reporteCliente') {
            document.getElementById('rep-cliente').value = `${cliente.nombre} | ${cliente.doc}`;
            renderContratosPorClienteSeleccionado();
        }
        if (destino === 'cambioCliente') {
            document.getElementById('con-cambio-cliente').value = `${cliente.nombre} | ${cliente.doc}`;
            renderContratosCambioCliente();
        }
        if (destino === 'arrendatario1' || destino === 'arrendatario2') {
            revisarHabilitacionDetallesContrato();
        }
    } else {
        const moto = dbMotos.find(m => String(m.placa) === String(id));
        if (!moto) return;
        if (destino === 'cambioMoto') {
            document.getElementById('con-cambio-moto-nueva').value = `${moto.placa} | ${moto.marca || ''} ${moto.referencia || ''}`;
            const alertaCambio = document.getElementById('alerta-docs-cambio');
            if (alertaCambio) {
                const estadoMoto = estadoDocumentalMoto(moto);
                alertaCambio.style.display = 'block';
                alertaCambio.innerText = estadoMoto === 'AL DIA' ? 'Moto nueva con documentos al dia.' : `Alerta moto nueva: ${estadoMoto}. Deben ser actualizados.`;
                alertaCambio.className = `mini-alert ${estadoMoto === 'AL DIA' ? 'ok' : 'warn'}`;
            }
        } else if (destino === 'reservaMoto') {
            const campo = document.getElementById('reserva-moto');
            if (campo) campo.value = `${moto.placa} | ${moto.marca || ''} ${moto.referencia || ''}`.trim();
        } else {
            document.getElementById('con-moto').value = `${moto.placa} | ${moto.marca || ''} ${moto.referencia || ''}`;
            const alerta = document.getElementById('alerta-docs-contrato');
            if (alerta) {
                const estado = estadoDocumentalMoto(moto);
                alerta.style.display = 'block';
                alerta.innerText = estado === 'AL DIA' ? 'Moto con documentos al dia.' : `Alerta: ${estado}. Deben ser actualizados.`;
                alerta.className = `mini-alert ${estado === 'AL DIA' ? 'ok' : 'warn'}`;
            }
        }
    }
    cerrarSelectorEntidad();
    renderResumenPagosContrato();
}

function clienteDocDesdeTextoContrato(texto) {
    return texto.includes('|') ? texto.split('|')[1].trim() : '';
}

function ordenarContratosRecientes(lista) {
    return [...lista].sort((a, b) => `${b.fechaInicio || ''} ${b.horaCreacion || ''}`.localeCompare(`${a.fechaInicio || ''} ${a.horaCreacion || ''}`));
}

function esContratoInicial(contrato) {
    return contrato && !contrato.contratoBase && (contrato.tipoProceso || 'NUEVO') !== 'CAMBIO';
}

function obtenerContratosIniciales() {
    return ordenarContratosRecientes(dbContratos.filter(esContratoInicial));
}

function obtenerEventosContratoBase(codigoBase) {
    const base = dbContratos.find(c => c.codigo === codigoBase);
    const eventos = [];
    if (base) {
        (base.historial || []).forEach(item => {
            eventos.push({
                fecha: item.fecha || '',
                tipo: 'CONTRATO',
                codigo: base.codigo,
                detalle: item.detalle || '',
                estado: base.estado || 'ACTIVO'
            });
        });
    }
    dbContratos.filter(c => c.contratoBase === codigoBase).forEach(cambio => {
        eventos.push({
            fecha: `${cambio.fechaInicio || ''} ${cambio.horaCreacion || ''}`.trim(),
            tipo: cambio.tipoProceso || 'CAMBIO',
            codigo: cambio.codigo,
            detalle: cambio.observaciones || 'Sin detalle',
            estado: cambio.estado || 'ACTIVO'
        });
        (cambio.historial || []).forEach(item => {
            eventos.push({
                fecha: item.fecha || '',
                tipo: cambio.tipoProceso || 'CAMBIO',
                codigo: cambio.codigo,
                detalle: item.detalle || '',
                estado: cambio.estado || 'ACTIVO'
            });
        });
    });
    return eventos.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
}

function limpiarFormularioCambioContrato() {
    contratoCambioPendienteCodigo = null;
    contratoCambioBase = null;
    ['con-cambio-cliente', 'con-cambio-contrato-base', 'con-cambio-estado-base', 'con-cambio-moto-base', 'con-cambio-cliente-resumen', 'con-cambio-gasolina-entrega', 'con-cambio-danos-entrega', 'con-cambio-estado-devolucion', 'con-cambio-limpieza-devolucion', 'con-cambio-gasolina-devolucion', 'con-cambio-moto-nueva', 'con-cambio-razon'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const limpieza = document.getElementById('con-cambio-limpieza-entrega');
    if (limpieza) limpieza.value = 'SI';
    const visual = document.getElementById('con-cambio-codigo-visual');
    if (visual) visual.innerText = 'SIN GENERAR';
    const lista = document.getElementById('con-cambio-contratos-lista');
    if (lista) lista.innerHTML = '';
    const form = document.getElementById('con-cambio-form-panel');
    if (form) form.style.display = 'none';
    const alerta = document.getElementById('alerta-docs-cambio');
    if (alerta) alerta.style.display = 'none';
}

function renderContratosCambioCliente() {
    const lista = document.getElementById('con-cambio-contratos-lista');
    if (!lista) return;
    const doc = clienteDocDesdeTextoContrato(document.getElementById('con-cambio-cliente')?.value || '');
    if (!doc) {
        lista.innerHTML = '';
        return;
    }
    const contratos = obtenerContratosIniciales().filter(c => (c.arrendatario1 || '').includes(doc) || (c.arrendatario2 || '').includes(doc));
    if (!contratos.length) {
        lista.innerHTML = '<div class="dashboard-empty">Este cliente no tiene contratos iniciales registrados.</div>';
        return;
    }
    lista.innerHTML = contratos.map(c => {
        const totalEventos = dbContratos.filter(item => item.contratoBase === c.codigo).length;
        return `<div class="dashboard-item"><div><strong>${c.codigo}</strong><small>${c.fechaInicio || ''} · ${c.estado || 'ACTIVO'} · ${c.moto || ''}${totalEventos ? ` · ${totalEventos} cambios/finalizaciones` : ''}</small></div><div class="doc-actions"><button class="btn-icon" type="button" onclick="verHistorialContratoBase('${c.codigo}')">Ver</button><button class="btn-icon" type="button" onclick="prepararCambioContrato('${c.codigo}')">Generar cambio</button></div></div>`;
    }).join('');
}

function prepararCambioContrato(codigo) {
    const contrato = dbContratos.find(item => item.codigo === codigo);
    if (!contrato) return;
    contratoCambioPendienteCodigo = codigo;
    const texto = `Se va a generar un cambio para el contrato ${codigo}. ¿Deseas continuar?`;
    document.getElementById('cambio-confirmacion-texto').innerText = texto;
    document.getElementById('modal-confirmar-cambio').classList.add('show');
}

function cerrarConfirmacionCambio() {
    document.getElementById('modal-confirmar-cambio').classList.remove('show');
    contratoCambioPendienteCodigo = null;
}

function confirmarCambioContratoPendiente() {
    if (!contratoCambioPendienteCodigo) return;
    const contrato = dbContratos.find(item => item.codigo === contratoCambioPendienteCodigo);
    if (!contrato) return cerrarConfirmacionCambio();
    contratoCambioBase = contrato;
    const codigoCambio = `CAM-${String(Date.now()).slice(-6)}`;
    document.getElementById('con-cambio-contrato-base').value = contrato.codigo;
    document.getElementById('con-cambio-estado-base').value = contrato.estado || 'ACTIVO';
    document.getElementById('con-cambio-moto-base').value = contrato.moto || '';
    document.getElementById('con-cambio-cliente-resumen').value = document.getElementById('con-cambio-cliente').value;
    document.getElementById('con-cambio-codigo-visual').innerText = `${contrato.codigo} · CAMBIO · ${codigoCambio}`;
    document.getElementById('con-cambio-form-panel').dataset.codigoCambio = codigoCambio;
    document.getElementById('con-cambio-form-panel').style.display = 'block';
    cerrarConfirmacionCambio();
    document.getElementById('con-cambio-form-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function guardarCambioContrato() {
    if (!contratoCambioBase) return mostrarAlerta('CONTRATO REQUERIDO', 'Primero selecciona el contrato al que le vas a generar el cambio.');
    const codigoCambio = document.getElementById('con-cambio-form-panel')?.dataset.codigoCambio || '';
    const motoNueva = document.getElementById('con-cambio-moto-nueva').value.trim();
    const razon = document.getElementById('con-cambio-razon').value.trim();
    if (!codigoCambio || !motoNueva || !razon) return mostrarAlerta('DATOS INCOMPLETOS', 'Selecciona la moto nueva y escribe la razon del cambio.');
    const cambio = {
        codigo: codigoCambio,
        estado: 'ACTIVO',
        tipoProceso: 'CAMBIO',
        contratoBase: contratoCambioBase.codigo,
        arrendatario1: contratoCambioBase.arrendatario1,
        arrendatario2: contratoCambioBase.arrendatario2,
        moto: motoNueva,
        motoAnterior: document.getElementById('con-cambio-moto-base').value,
        fechaInicio: obtenerFechaHoy(),
        horaCreacion: new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        valor: contratoCambioBase.valor || '',
        observaciones: razon,
        detalleCambio: {
            limpiezaEntrega: document.getElementById('con-cambio-limpieza-entrega').value,
            gasolinaEntrega: document.getElementById('con-cambio-gasolina-entrega').value.trim(),
            danosEntrega: document.getElementById('con-cambio-danos-entrega').value.trim(),
            estadoDevolucion: document.getElementById('con-cambio-estado-devolucion').value.trim(),
            limpiezaDevolucion: document.getElementById('con-cambio-limpieza-devolucion').value.trim(),
            gasolinaDevolucion: document.getElementById('con-cambio-gasolina-devolucion').value.trim(),
            razon
        },
        historial: [{ fecha: obtenerFechaHoraActual(), detalle: `Cambio generado desde ${contratoCambioBase.codigo}` }]
    };
    dbContratos.unshift(cambio);
    const original = dbContratos.find(item => item.codigo === contratoCambioBase.codigo);
    if (original) {
        original.estado = 'CAMBIADO';
        original.historial = original.historial || [];
        original.historial.push({ fecha: obtenerFechaHoraActual(), detalle: `Se genero cambio ${codigoCambio} por motivo: ${razon}` });
    }
    persistirContratos();
    renderListaContratos();
    renderContratosCambioCliente();
    mostrarAlerta('CAMBIO GENERADO', `Se guardo el cambio ${codigoCambio} correctamente.`);
}

function iniciarRelojContrato() {
    detenerRelojContrato();
    actualizarHoraContrato();
    contratoClockInterval = setInterval(actualizarHoraContrato, 1000);
}

function detenerRelojContrato() {
    if (contratoClockInterval) clearInterval(contratoClockInterval);
    contratoClockInterval = null;
}

function actualizarHoraContrato() {
    const hora = document.getElementById('con-hora-creacion');
    if (hora) hora.value = new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function inicializarMoneyInputsContrato() {
    document.querySelectorAll('[data-money="1"]').forEach(input => {
        if (input.dataset.moneyReady === '1') return;
        input.dataset.moneyReady = '1';
        input.addEventListener('input', e => {
            formatearMontoInput(e.target);
            if (e.target.id === 'modal-total-alquiler-input' || e.target.id === 'modal-total-deposito-input') sincronizarTotalesDesdeModal();
            renderResumenPagosContrato();
        });
        input.addEventListener('blur', e => {
            formatearMontoInput(e.target);
            if (e.target.id === 'modal-total-alquiler-input' || e.target.id === 'modal-total-deposito-input') sincronizarTotalesDesdeModal();
            renderResumenPagosContrato();
        });
    });
}

function formatearMontoInput(input) {
    if (!input) return;
    const numero = parseMoneyInput(input.value);
    input.value = numero ? numero.toLocaleString('es-CO') : '';
}

function parseMoneyInput(valor) {
    const limpio = String(valor || '').replace(/[^\d]/g, '');
    return limpio ? Number(limpio) : 0;
}

function setMoneyText(id, valor) {
    const el = document.getElementById(id);
    if (el) el.innerText = Number(valor || 0).toLocaleString('es-CO');
}

function inicializarFuelScale() {
    const contenedor = document.getElementById('con-fuel-scale');
    if (!contenedor || contenedor.dataset.ready === '1') return;
    contenedor.dataset.ready = '1';
    contenedor.innerHTML = Array.from({ length: 10 }, (_, idx) => `<button class="fuel-cell" type="button" data-level="${idx + 1}" aria-label="Nivel ${idx + 1}" onclick="setFuelLevel(${idx + 1})"></button>`).join('');
    contenedor.addEventListener('mousemove', event => {
        const celda = event.target.closest('.fuel-cell');
        if (!celda) return;
        previsualizarFuelLevel(Number(celda.dataset.level));
    });
    contenedor.addEventListener('mouseleave', () => {
        previsualizarFuelLevel(Number(document.getElementById('con-fuel-level')?.value || 0));
    });
}

function previsualizarFuelLevel(level) {
    document.querySelectorAll('#con-fuel-scale .fuel-cell').forEach(cell => {
        cell.classList.toggle('preview', Number(cell.dataset.level) <= level);
    });
}

function setFuelLevel(level) {
    const input = document.getElementById('con-fuel-level');
    if (input) input.value = String(level);
    document.querySelectorAll('#con-fuel-scale .fuel-cell').forEach(cell => {
        const activo = Number(cell.dataset.level) <= level;
        cell.classList.toggle('active', activo);
        cell.classList.toggle('preview', activo);
    });
    const label = document.getElementById('con-fuel-label');
    if (label) label.innerText = `${level} / 10`;
}

function setEntregaItem(tipo, estado) {
    const btn = document.getElementById(`con-entrega-${tipo}`);
    if (!btn) return;
    btn.dataset.value = estado ? 'SI' : 'NO';
    btn.innerText = estado ? 'SI' : 'NO';
    btn.classList.toggle('yes', estado);
    btn.classList.toggle('no', !estado);
}

function toggleEntregaItem(tipo) {
    const btn = document.getElementById(`con-entrega-${tipo}`);
    if (!btn) return;
    setEntregaItem(tipo, btn.dataset.value !== 'SI');
}

function seleccionarEstadoEntrega(valor) {
    document.querySelectorAll('#con-estado-entrega .condition-option').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.value === valor);
    });
    const contenedor = document.getElementById('con-estado-entrega');
    if (contenedor) contenedor.dataset.value = valor;
}

function inicializarFechaDevolucionContrato() {
    const dia = document.getElementById('con-devolucion-dia');
    const mes = document.getElementById('con-devolucion-mes');
    const anio = document.getElementById('con-devolucion-anio');
    if (!dia || !mes || !anio || dia.dataset.ready === '1') return;
    dia.dataset.ready = '1';
    const meses = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
    dia.innerHTML = Array.from({ length: 31 }, (_, idx) => `<option value="${String(idx + 1).padStart(2, '0')}">${String(idx + 1).padStart(2, '0')}</option>`).join('');
    mes.innerHTML = meses.map((item, idx) => `<option value="${String(idx + 1).padStart(2, '0')}">${item}</option>`).join('');
    anio.value = String(new Date().getFullYear());
    const hoy = new Date();
    dia.value = String(hoy.getDate()).padStart(2, '0');
    mes.value = String(hoy.getMonth() + 1).padStart(2, '0');
    sincronizarFechaDevolucionContrato(true);
}

function sincronizarFechaDevolucionContrato(forzarActual) {
    const dia = document.getElementById('con-devolucion-dia');
    const mes = document.getElementById('con-devolucion-mes');
    const anio = document.getElementById('con-devolucion-anio');
    const hidden = document.getElementById('con-fecha-devolucion');
    if (!dia || !mes || !anio || !hidden) return;
    if (forzarActual) anio.value = String(new Date().getFullYear());
    hidden.value = `${anio.value}-${mes.value}-${dia.value}`;
}

function toggleFechaDevolucionIndefinida(checked) {
    const dia = document.getElementById('con-devolucion-dia');
    const mes = document.getElementById('con-devolucion-mes');
    const hidden = document.getElementById('con-fecha-devolucion');
    const detallesHabilitados = !document.getElementById('btn-guardar-contrato')?.disabled;
    if (!dia || !mes || !hidden) return;
    dia.disabled = !detallesHabilitados || Boolean(checked);
    mes.disabled = !detallesHabilitados || Boolean(checked);
    if (checked) hidden.value = '';
    else sincronizarFechaDevolucionContrato();
}

function crearEstadoPagosContrato() {
    return {
        reservaId: '',
        abonoReserva: 0,
        alquiler: { total: 0, pagos: [] },
        deposito: { total: 0, pagos: [] }
    };
}

function obtenerClienteReservaContrato() {
    const arr1 = document.getElementById('con-arrendatario-1')?.value || '';
    const arr2 = document.getElementById('con-arrendatario-2')?.value || '';
    return [arr1, arr2].filter(Boolean);
}

function obtenerFechaReservaAsociada() {
    const reservaId = contratoPagosTemp?.reservaId || '';
    const clientes = obtenerClienteReservaContrato();
    const reserva = (reservaId ? dashboardData.reservas.filter(item => item.id === reservaId) : dashboardData.reservas
        .filter(item => !item.contratoCodigo && clientes.some(cliente => normalizarBusqueda(item.cliente || '').includes(normalizarBusqueda(cliente.split('|')[0])))))
        .sort((a, b) => `${b.fecha || ''} ${b.hora || ''}`.localeCompare(`${a.fecha || ''} ${a.hora || ''}`))[0];
    if (!reserva) return { fechaHora: '-', descripcion: 'Abono previo de reserva' };
    return {
        fechaHora: `${reserva.fecha || '-'} ${reserva.hora || ''}`.trim(),
        descripcion: `Abono previo de reserva${reserva.cliente ? ` de ${reserva.cliente}` : ''}`
    };
}

function revisarPagosReservaContrato() {
    const clientes = obtenerClienteReservaContrato();
    if (!clientes.length) return mostrarAlerta('CLIENTE REQUERIDO', 'Primero selecciona el arrendatario para buscar sus reservas.');
    document.getElementById('modal-reservas-contrato')?.classList.add('show');
    renderReservasDisponiblesContrato();
}

function cerrarModalReservasContrato() {
    document.getElementById('modal-reservas-contrato')?.classList.remove('show');
}

function renderReservasDisponiblesContrato() {
    const lista = document.getElementById('lista-reservas-contrato');
    if (!lista) return;
    const q = normalizarBusqueda(document.getElementById('buscar-reserva-contrato')?.value || '');
    const clientes = obtenerClienteReservaContrato();
    const reservas = dashboardData.reservas
        .filter(item => !item.contratoCodigo)
        .filter(item => clientes.some(cliente => normalizarBusqueda(item.cliente || '').includes(normalizarBusqueda(cliente.split('|')[0]))))
        .filter(item => !q || normalizarBusqueda(`${item.cliente} ${item.fecha} ${item.tipo}`).includes(q))
        .sort((a, b) => `${b.fecha || ''} ${b.hora || ''}`.localeCompare(`${a.fecha || ''} ${a.hora || ''}`));
    if (!reservas.length) {
        lista.innerHTML = '<div class="dashboard-empty">No hay reservas disponibles para cargar en este contrato.</div>';
        return;
    }
    lista.innerHTML = reservas.map(item => `
        <div class="dashboard-item">
            <div>
                <strong>${item.cliente}</strong>
                <small>${item.fecha} · ${item.hora} · ${item.tipo}${item.abono ? ` · Abono: ${item.abono}` : ''}</small>
            </div>
            <div class="doc-actions">
                <button class="btn-icon" type="button" onclick="verReciboReserva('${item.id}')">Ver</button>
                <button class="btn-action" type="button" onclick="cargarReservaEnContrato('${item.id}')">Cargar</button>
            </div>
        </div>
    `).join('');
}

function cargarReservaEnContrato(id) {
    const reserva = obtenerReserva(id);
    if (!reserva) return;
    if (!contratoPagosTemp) contratoPagosTemp = crearEstadoPagosContrato();
    contratoPagosTemp.reservaId = id;
    contratoPagosTemp.abonoReserva = parseMoneyInput(reserva.abono || reserva.abonoTotal || 0);
    setMoneyText('con-abono-reserva', contratoPagosTemp.abonoReserva);
    cerrarModalReservasContrato();
    renderResumenPagosContrato();
}

function renderResumenPagosContrato() {
    const totalAlquiler = parseMoneyInput(document.getElementById('con-valor')?.value || '');
    if (!contratoPagosTemp) contratoPagosTemp = crearEstadoPagosContrato();
    contratoPagosTemp.alquiler.total = totalAlquiler;
    const abonoReserva = Number(contratoPagosTemp.abonoReserva || 0);
    const alquilerPagado = contratoPagosTemp.alquiler.pagos.reduce((acc, item) => acc + Number(item.valor || 0), 0);
    const depositoPagado = contratoPagosTemp.deposito.pagos.reduce((acc, item) => acc + Number(item.valor || 0), 0);
    const totalPagadoAlquiler = alquilerPagado + abonoReserva;
    const saldoAlquiler = Math.max(totalAlquiler - totalPagadoAlquiler, 0);
    const saldoDeposito = Math.max(Number(contratoPagosTemp.deposito.total || 0) - depositoPagado, 0);
    const totalPagos = totalPagadoAlquiler + depositoPagado;
    setMoneyText('con-total-pagado-visual', totalPagadoAlquiler);
    setMoneyText('con-saldo-pendiente-visual', saldoAlquiler);
    setMoneyText('con-deposito-pagado-visual', depositoPagado);
    setMoneyText('con-deposito-saldo-visual', saldoDeposito);
    setMoneyText('con-total-general-pagos-visual', totalPagos);
    const body = document.getElementById('con-payment-history-body');
    if (!body) return;
    const filas = [];
    if (abonoReserva) {
        const reservaInfo = obtenerFechaReservaAsociada();
        filas.push(`<tr><td>${reservaInfo.fechaHora}</td><td>ALQUILER</td><td>${reservaInfo.descripcion}</td><td>Reserva</td><td>${abonoReserva.toLocaleString('es-CO')}</td></tr>`);
    }
    contratoPagosTemp.alquiler.pagos.forEach(item => {
        filas.push(`<tr><td>${item.fechaHora || '-'}</td><td>${item.concepto}</td><td>${item.descripcion}</td><td>${item.medio}</td><td>${item.valor.toLocaleString('es-CO')}</td></tr>`);
    });
    contratoPagosTemp.deposito.pagos.forEach(item => {
        filas.push(`<tr><td>${item.fechaHora || '-'}</td><td>${item.concepto}</td><td>${item.descripcion}</td><td>${item.medio}</td><td>${item.valor.toLocaleString('es-CO')}</td></tr>`);
    });
    body.innerHTML = filas.length ? filas.join('') : '<tr><td colspan="5">Todavia no hay pagos registrados.</td></tr>';
    actualizarResumenModalPagos(saldoAlquiler, saldoDeposito);
}

function construirPagosContrato() {
    if (!contratoPagosTemp) contratoPagosTemp = crearEstadoPagosContrato();
    const totalAlquiler = parseMoneyInput(document.getElementById('con-valor')?.value || '');
    contratoPagosTemp.alquiler.total = totalAlquiler;
    return {
        abonoReserva: Number(contratoPagosTemp.abonoReserva || 0),
        alquiler: {
            total: totalAlquiler,
            pagado: contratoPagosTemp.alquiler.pagos.reduce((acc, item) => acc + Number(item.valor || 0), 0) + Number(contratoPagosTemp.abonoReserva || 0),
            saldo: Math.max(totalAlquiler - (contratoPagosTemp.alquiler.pagos.reduce((acc, item) => acc + Number(item.valor || 0), 0) + Number(contratoPagosTemp.abonoReserva || 0)), 0),
            pagos: Number(contratoPagosTemp.abonoReserva || 0) ? [{ concepto: 'ALQUILER', descripcion: obtenerFechaReservaAsociada().descripcion, medio: 'Reserva', valor: Number(contratoPagosTemp.abonoReserva || 0), fechaHora: obtenerFechaReservaAsociada().fechaHora }, ...contratoPagosTemp.alquiler.pagos] : [...contratoPagosTemp.alquiler.pagos]
        },
        deposito: {
            total: Number(contratoPagosTemp.deposito.total || 0),
            pagado: contratoPagosTemp.deposito.pagos.reduce((acc, item) => acc + Number(item.valor || 0), 0),
            saldo: Math.max(Number(contratoPagosTemp.deposito.total || 0) - contratoPagosTemp.deposito.pagos.reduce((acc, item) => acc + Number(item.valor || 0), 0), 0),
            pagos: [...contratoPagosTemp.deposito.pagos]
        }
    };
}

function abrirModalPagosContrato() {
    if (!contratoPagosTemp) contratoPagosTemp = crearEstadoPagosContrato();
    document.getElementById('modal-pagos-contrato')?.classList.add('show');
    document.getElementById('modal-total-alquiler-input').value = Number(parseMoneyInput(document.getElementById('con-valor')?.value || contratoPagosTemp.alquiler.total || 0)).toLocaleString('es-CO');
    document.getElementById('modal-total-deposito-input').value = Number(contratoPagosTemp.deposito.total || 0).toLocaleString('es-CO');
    document.getElementById('modal-pago-valor').value = '';
    document.getElementById('modal-pago-descripcion').value = '';
    renderPagosModalContrato();
}

function sincronizarTotalesDesdeModal() {
    if (!contratoPagosTemp) contratoPagosTemp = crearEstadoPagosContrato();
    contratoPagosTemp.alquiler.total = parseMoneyInput(document.getElementById('modal-total-alquiler-input')?.value || 0);
    contratoPagosTemp.deposito.total = parseMoneyInput(document.getElementById('modal-total-deposito-input')?.value || 0);
    document.getElementById('con-valor').value = contratoPagosTemp.alquiler.total ? contratoPagosTemp.alquiler.total.toLocaleString('es-CO') : '';
    actualizarResumenModalPagos();
}

function cerrarModalPagosContrato() {
    document.getElementById('modal-pagos-contrato')?.classList.remove('show');
    renderResumenPagosContrato();
}

function actualizarResumenModalPagos(saldoAlquilerArg, saldoDepositoArg) {
    if (!contratoPagosTemp) contratoPagosTemp = crearEstadoPagosContrato();
    const totalAlquiler = Number(contratoPagosTemp.alquiler.total || 0);
    const pagadoAlquiler = contratoPagosTemp.alquiler.pagos.reduce((acc, item) => acc + Number(item.valor || 0), 0) + Number(contratoPagosTemp.abonoReserva || 0);
    const totalDeposito = Number(contratoPagosTemp.deposito.total || 0);
    const pagadoDeposito = contratoPagosTemp.deposito.pagos.reduce((acc, item) => acc + Number(item.valor || 0), 0);
    const saldoAlquiler = saldoAlquilerArg ?? Math.max(totalAlquiler - pagadoAlquiler, 0);
    const saldoDeposito = saldoDepositoArg ?? Math.max(totalDeposito - pagadoDeposito, 0);
    const totalPagos = pagadoAlquiler + pagadoDeposito;
    ['modal-abono-reserva', 'con-abono-reserva'].forEach(id => setMoneyText(id, contratoPagosTemp.abonoReserva || 0));
    setMoneyText('modal-total-alquiler', totalAlquiler);
    setMoneyText('modal-total-deposito', totalDeposito);
    setMoneyText('modal-pagado-alquiler', pagadoAlquiler);
    setMoneyText('modal-saldo-alquiler', saldoAlquiler);
    setMoneyText('modal-pagado-deposito', pagadoDeposito);
    setMoneyText('modal-saldo-deposito', saldoDeposito);
    setMoneyText('modal-total-pagos', totalPagos);
}

function renderPagosModalContrato() {
    const body = document.getElementById('modal-pagos-body');
    if (!body) return;
    const filas = [];
    if (Number(contratoPagosTemp?.abonoReserva || 0)) {
        const reservaInfo = obtenerFechaReservaAsociada();
        filas.push(`<tr><td>${reservaInfo.fechaHora}</td><td>ALQUILER</td><td>${reservaInfo.descripcion}</td><td>Reserva</td><td>${Number(contratoPagosTemp.abonoReserva).toLocaleString('es-CO')}</td><td></td></tr>`);
    }
    [...(contratoPagosTemp?.alquiler?.pagos || []), ...(contratoPagosTemp?.deposito?.pagos || [])].forEach((item, idx) => {
        filas.push(`<tr><td>${item.fechaHora || '-'}</td><td>${item.concepto}</td><td>${item.descripcion}</td><td>${item.medio}</td><td>${Number(item.valor || 0).toLocaleString('es-CO')}</td><td><button class="btn-icon" type="button" onclick="eliminarPagoContrato(${idx}, '${item.concepto}')">Quitar</button></td></tr>`);
    });
    body.innerHTML = filas.length ? filas.join('') : '<tr><td colspan="6">Todavia no hay pagos cargados.</td></tr>';
    actualizarResumenModalPagos();
}

function agregarPagoContratoDesdeModal() {
    if (!contratoPagosTemp) contratoPagosTemp = crearEstadoPagosContrato();
    contratoPagosTemp.alquiler.total = parseMoneyInput(document.getElementById('modal-total-alquiler-input')?.value || 0);
    contratoPagosTemp.deposito.total = parseMoneyInput(document.getElementById('modal-total-deposito-input')?.value || 0);
    document.getElementById('con-valor').value = contratoPagosTemp.alquiler.total ? contratoPagosTemp.alquiler.total.toLocaleString('es-CO') : '';
    const concepto = document.getElementById('modal-pago-concepto')?.value || 'ALQUILER';
    const medio = document.getElementById('modal-pago-medio')?.value || 'Efectivo';
    const valor = parseMoneyInput(document.getElementById('modal-pago-valor')?.value || 0);
    const descripcion = document.getElementById('modal-pago-descripcion')?.value.trim() || `Pago ${concepto.toLowerCase()}`;
    if (!valor) return mostrarAlerta('VALOR REQUERIDO', 'Escribe el valor que se va a cargar.');
    const pago = { concepto, medio, valor, descripcion, fechaHora: obtenerFechaHoraActual() };
    if (concepto === 'ALQUILER') contratoPagosTemp.alquiler.pagos.push(pago);
    else contratoPagosTemp.deposito.pagos.push(pago);
    document.getElementById('modal-pago-valor').value = '';
    document.getElementById('modal-pago-descripcion').value = '';
    renderPagosModalContrato();
    renderResumenPagosContrato();
}

function eliminarPagoContrato(index, concepto) {
    if (!contratoPagosTemp) return;
    const lista = concepto === 'ALQUILER' ? contratoPagosTemp.alquiler.pagos : contratoPagosTemp.deposito.pagos;
    const offset = concepto === 'DEPOSITO' ? contratoPagosTemp.alquiler.pagos.length : 0;
    lista.splice(index - offset, 1);
    renderPagosModalContrato();
    renderResumenPagosContrato();
}

function obtenerContratoDesdeFormulario() {
    const codigo = document.getElementById('con-codigo').value.trim();
    const arr1 = document.getElementById('con-arrendatario-1').value.trim();
    const arr2 = document.getElementById('con-arrendatario-2').value.trim();
    const moto = document.getElementById('con-moto').value.trim();
    if (!codigo || !arr1 || !moto) return null;
    return {
        codigo,
        estado: 'ACTIVO',
        tipoProceso: 'NUEVO',
        arrendatario1: arr1,
        arrendatario2: arr2,
        moto,
        fechaInicio: document.getElementById('con-fecha-inicio').value,
        horaCreacion: document.getElementById('con-hora-creacion').value,
        fechaDevolucion: document.getElementById('con-fecha-indefinida')?.checked ? 'INDEFINIDO' : document.getElementById('con-fecha-devolucion')?.value || '',
        tipoContrato: document.getElementById('con-tipo-contrato')?.value || 'CORTO',
        valor: parseMoneyInput(document.getElementById('con-valor').value || ''),
        observaciones: document.getElementById('con-observaciones').value.trim(),
        entregaLlaves: document.getElementById('con-entrega-llaves')?.dataset.value || 'NO',
        entregaMatricula: document.getElementById('con-entrega-matricula')?.dataset.value || 'NO',
        nivelGasolina: Number(document.getElementById('con-fuel-level')?.value || 0),
        novedadesEntrega: document.getElementById('con-novedades-entrega')?.value.trim() || '',
        pagos: construirPagosContrato(),
        historial: [{ fecha: obtenerFechaHoraActual(), detalle: 'Contrato nuevo creado' }]
    };
}

async function exportarContratoACarpetaCliente(contrato) {
    if (!window.showDirectoryPicker) return false;
    try {
        const baseDir = await obtenerSubcarpetaBaseSilenciosa('contratos');
        if (!baseDir) return false;
        const nombreCliente = normalizarTextoArchivo((contrato.arrendatario1 || 'CLIENTE').split('|')[0].trim());
        const carpetaCliente = await baseDir.getDirectoryHandle(nombreCliente, { create: true });
        const carpetaContrato = await carpetaCliente.getDirectoryHandle(normalizarTextoArchivo(contrato.codigo), { create: true });
        await escribirArchivoTexto(carpetaContrato, 'contrato.json', JSON.stringify(contrato, null, 2));
        await escribirArchivoTexto(carpetaContrato, 'contrato.html', construirHtmlImpresionContrato(contrato));
        return true;
    } catch (error) {
        console.error(error);
        return false;
    }
}

function construirResumenContrato(contrato) {
    const pagos = contrato.pagos || {};
    const alquiler = { total: 0, pagado: 0, saldo: 0, pagos: [], ...(pagos.alquiler || {}) };
    const deposito = { total: 0, pagado: 0, saldo: 0, pagos: [], ...(pagos.deposito || {}) };
    return {
        codigo: contrato.codigo,
        arr1: contrato.arrendatario1,
        arr2: contrato.arrendatario2 || '-',
        moto: contrato.moto,
        fecha: contrato.fechaInicio,
        hora: contrato.horaCreacion,
        devolucion: contrato.fechaDevolucion || '-',
        llaves: contrato.entregaLlaves || 'NO',
        matricula: contrato.entregaMatricula || 'NO',
        gasolina: `${contrato.nivelGasolina || 0} / 10`,
        novedades: contrato.novedadesEntrega || '-',
        valor: Number(contrato.valor || 0).toLocaleString('es-CO'),
        observaciones: contrato.observaciones || '-',
        alquiler,
        deposito
    };
}

function construirTablaPagosContrato(contrato) {
    const alquiler = contrato.pagos?.alquiler?.pagos || [];
    const deposito = contrato.pagos?.deposito?.pagos || [];
    const filas = [...alquiler, ...deposito];
    if (!filas.length) return '<tr><td colspan="5">Sin pagos registrados.</td></tr>';
    return filas.map(item => `<tr><td>${item.fechaHora || '-'}</td><td>${item.concepto}</td><td>${item.descripcion}</td><td>${item.medio}</td><td>${Number(item.valor || 0).toLocaleString('es-CO')}</td></tr>`).join('');
}

function construirHtmlImpresionContrato(contrato) {
    const data = construirResumenContrato(contrato);
    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>${data.codigo}</title>
<style>
body { font-family: Arial, sans-serif; padding: 28px; color: #222; }
h1, h2 { margin: 0 0 12px; }
.top { margin-bottom: 24px; }
.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 20px; margin-bottom: 20px; }
.box { border: 1px solid #ddd; border-radius: 12px; padding: 14px; }
.label { font-size: 12px; color: #666; text-transform: uppercase; margin-bottom: 4px; }
.value { font-size: 14px; font-weight: 600; }
table { width: 100%; border-collapse: collapse; margin-top: 12px; }
th, td { border: 1px solid #ddd; padding: 10px; text-align: left; font-size: 13px; }
th { background: #f5f5f5; }
</style>
</head>
<body>
    <div class="top">
        <h1>Contrato ${data.codigo}</h1>
        <p>Vista previa imprimible del contrato.</p>
    </div>
    <div class="grid">
        <div class="box"><div class="label">Arrendatario 1</div><div class="value">${data.arr1}</div></div>
        <div class="box"><div class="label">Arrendatario 2</div><div class="value">${data.arr2}</div></div>
        <div class="box"><div class="label">Moto</div><div class="value">${data.moto}</div></div>
        <div class="box"><div class="label">Fecha / Hora</div><div class="value">${data.fecha} ${data.hora}</div></div>
        <div class="box"><div class="label">Fecha devolucion</div><div class="value">${data.devolucion}</div></div>
        <div class="box"><div class="label">Valor alquiler</div><div class="value">${data.valor}</div></div>
        <div class="box"><div class="label">Entrega llaves</div><div class="value">${data.llaves}</div></div>
        <div class="box"><div class="label">Entrega matricula</div><div class="value">${data.matricula}</div></div>
        <div class="box"><div class="label">Gasolina</div><div class="value">${data.gasolina}</div></div>
    </div>
    <div class="box" style="margin-bottom:20px;">
        <div class="label">Novedades</div>
        <div class="value">${data.novedades}</div>
    </div>
    <div class="box" style="margin-bottom:20px;">
        <div class="label">Observaciones</div>
        <div class="value">${data.observaciones}</div>
    </div>
    <h2>Resumen alquiler</h2>
    <div class="grid">
        <div class="box"><div class="label">Total</div><div class="value">${Number(data.alquiler.total || 0).toLocaleString('es-CO')}</div></div>
        <div class="box"><div class="label">Pagado</div><div class="value">${Number(data.alquiler.pagado || 0).toLocaleString('es-CO')}</div></div>
        <div class="box"><div class="label">Saldo</div><div class="value">${Number(data.alquiler.saldo || 0).toLocaleString('es-CO')}</div></div>
        <div class="box"><div class="label">Recibido</div><div class="value">${Number(data.alquiler.pagado || 0).toLocaleString('es-CO')}</div></div>
    </div>
    <h2>Resumen deposito</h2>
    <div class="grid">
        <div class="box"><div class="label">Total</div><div class="value">${Number(data.deposito.total || 0).toLocaleString('es-CO')}</div></div>
        <div class="box"><div class="label">Pagado</div><div class="value">${Number(data.deposito.pagado || 0).toLocaleString('es-CO')}</div></div>
        <div class="box"><div class="label">Saldo</div><div class="value">${Number(data.deposito.saldo || 0).toLocaleString('es-CO')}</div></div>
        <div class="box"><div class="label">Recibido</div><div class="value">${Number(data.deposito.pagado || 0).toLocaleString('es-CO')}</div></div>
    </div>
    <h2>Historial de pagos</h2>
    <table>
        <thead>
            <tr><th>Fecha y hora</th><th>Concepto</th><th>Descripcion</th><th>Medio</th><th>Valor</th></tr>
        </thead>
        <tbody>${construirTablaPagosContrato(contrato)}</tbody>
    </table>
</body>
</html>`;
}

function abrirVistaImpresionContrato(contrato) {
    const html = construirHtmlImpresionContrato(contrato);
    const ventana = window.open('', '_blank', 'width=980,height=820');
    if (!ventana) return mostrarAlerta('VENTANA BLOQUEADA', 'El navegador bloqueo la vista previa. Permite ventanas emergentes para imprimir.');
    ventana.document.open();
    ventana.document.write(html);
    ventana.document.close();
    ventana.focus();
    return ventana;
}

async function guardarContrato() {
    const contrato = obtenerContratoDesdeFormulario();
    if (!contrato) return mostrarAlerta('DATOS INCOMPLETOS', 'Codigo, arrendatario 1 y moto son obligatorios.');
    detenerRelojContrato();
    contrato.horaCreacion = document.getElementById('con-hora-creacion')?.value || contrato.horaCreacion;
    const existenteIdx = dbContratos.findIndex(c => c.codigo === contrato.codigo);
    if (existenteIdx >= 0) dbContratos[existenteIdx] = contrato;
    else dbContratos.unshift(contrato);
    if (contratoPagosTemp?.reservaId) {
        const reserva = dashboardData.reservas.find(item => item.id === contratoPagosTemp.reservaId);
        if (reserva) {
            reserva.contratoCodigo = contrato.codigo;
            reserva.cargadaContrato = true;
        }
        persistirDashboard();
    }
    persistirContratos();
    renderListaContratos();
    contratoUltimoCreado = contrato;
    await exportarContratoACarpetaCliente(contrato);
    const imprimir = document.getElementById('btn-imprimir-contrato');
    if (imprimir) imprimir.disabled = false;
    mostrarAlerta('PROCESO COMPLETADO', 'Contrato guardado correctamente.');
}

function generarPdfContrato() {
    const contrato = obtenerContratoDesdeFormulario();
    if (!contrato) return mostrarAlerta('DATOS REQUERIDOS', 'Primero genera el codigo y completa al menos arrendatario 1 y moto.');
    abrirVistaImpresionContrato(contrato);
}

function imprimirContratoCreado() {
    if (!contratoUltimoCreado) return mostrarAlerta('CONTRATO REQUERIDO', 'Primero crea el contrato para habilitar la impresion.');
    const ventana = abrirVistaImpresionContrato(contratoUltimoCreado);
    if (!ventana) return;
    setTimeout(() => {
        try { ventana.print(); } catch {}
    }, 300);
}

function renderListaContratos() {
    const lista = document.getElementById('lista-contratos');
    const detalle = document.getElementById('detalle-historial-contrato');
    if (!lista) return;
    const busqueda = normalizarBusqueda(document.getElementById('historial-contrato-busqueda')?.value || '');
    const tokens = busqueda.split(/\s+/).filter(Boolean);
    if (!tokens.length) {
        lista.innerHTML = '<div class="dashboard-empty">Escribe el nombre del cliente para buscar sus contratos.</div>';
        if (detalle) {
            detalle.style.display = 'none';
            detalle.innerHTML = '';
        }
        return;
    }
    const contratos = obtenerContratosIniciales().filter(c => {
        const texto = normalizarBusqueda(`${c.arrendatario1 || ''} ${c.arrendatario2 || ''}`);
        return tokens.every(token => texto.includes(token));
    });
    if (!contratos.length) {
        lista.innerHTML = '<div class="dashboard-empty">No se encontraron contratos para esa busqueda.</div>';
        if (detalle) {
            detalle.style.display = 'none';
            detalle.innerHTML = '';
        }
        return;
    }
    lista.innerHTML = contratos.map(c => {
        const totalEventos = dbContratos.filter(item => item.contratoBase === c.codigo).length;
        const estadoClase = ['ACTIVO', 'ABIERTO'].includes(String(c.estado || '').toUpperCase()) ? 'open' : 'closed';
        return `<div class="dashboard-item">
            <div>
                <strong>${c.codigo}</strong>
                <small>${c.arrendatario1} · ${c.moto || ''}${totalEventos ? ` · ${totalEventos} cambios/finalizaciones` : ''}</small>
            </div>
            <div class="doc-actions">
                <span class="chat-status-badge ${estadoClase}">${c.estado || 'ACTIVO'}</span>
                <button class="btn-icon" onclick="verHistorialContratoBase('${c.codigo}')">Ver</button>
                <button class="btn-icon" onclick="abrirVistaContratoPorCodigo('${c.codigo}')">PDF</button>
            </div>
        </div>`;
    }).join('');
}

function verHistorialContratoBase(codigo) {
    const contrato = dbContratos.find(item => item.codigo === codigo);
    const contenedor = document.getElementById('detalle-historial-contrato');
    if (!contrato || !contenedor) return;
    const eventos = obtenerEventosContratoBase(codigo);
    contenedor.style.display = 'block';
    contenedor.innerHTML = `
        <table class="excel-table">
            <thead>
                <tr>
                    <th>Fecha</th>
                    <th>Tipo</th>
                    <th>Codigo</th>
                    <th>Estado</th>
                    <th>Detalle</th>
                    <th>PDF</th>
                </tr>
            </thead>
            <tbody>
                ${eventos.length ? eventos.map(item => `
                    <tr>
                        <td>${item.fecha || '-'}</td>
                        <td>${item.tipo || '-'}</td>
                        <td>${item.codigo || '-'}</td>
                        <td><span class="chat-status-badge ${['ACTIVO', 'ABIERTO'].includes(String(item.estado || '').toUpperCase()) ? 'open' : 'closed'}">${item.estado || '-'}</span></td>
                        <td>${item.detalle || '-'}</td>
                        <td><button class="btn-icon" type="button" onclick="abrirVistaContratoPorCodigo('${item.codigo || codigo}')">Ver PDF</button></td>
                    </tr>
                `).join('') : '<tr><td colspan="6">Sin historial asociado.</td></tr>'}
            </tbody>
        </table>
    `;
}

function abrirVistaContratoPorCodigo(codigo) {
    const contrato = dbContratos.find(item => item.codigo === codigo) || dbContratos.find(item => item.contratoBase === codigo);
    if (!contrato) return mostrarAlerta('CONTRATO NO ENCONTRADO', 'No se encontro la informacion del contrato para visualizar.');
    abrirVistaImpresionContrato(contrato);
}

function cargarContrato(codigo) {
    const c = dbContratos.find(item => item.codigo === codigo);
    if (!c) return;
    if (!esContratoInicial(c)) return verHistorialContratoBase(c.contratoBase || c.codigo);
    seleccionarModoContrato(c.tipoProceso || 'NUEVO');
    document.getElementById('con-codigo').value = c.codigo;
    document.getElementById('con-estado').value = c.estado || 'ACTIVO';
    document.getElementById('con-arrendatario-1').value = c.arrendatario1;
    document.getElementById('con-arrendatario-2').value = c.arrendatario2;
    document.getElementById('con-moto').value = c.moto;
    document.getElementById('con-fecha-inicio').value = c.fechaInicio || '';
    document.getElementById('con-hora-creacion').value = c.horaCreacion || '';
    document.getElementById('con-valor').value = Number(c.valor || 0).toLocaleString('es-CO');
    const tipoContrato = document.getElementById('con-tipo-contrato');
    if (tipoContrato) tipoContrato.value = c.tipoContrato || 'CORTO';
    document.getElementById('con-observaciones').value = c.observaciones || '';
    if (c.fechaDevolucion && c.fechaDevolucion !== 'INDEFINIDO') {
        const [anio, mes, dia] = c.fechaDevolucion.split('-');
        document.getElementById('con-devolucion-anio').value = anio || String(new Date().getFullYear());
        document.getElementById('con-devolucion-mes').value = mes || String(new Date().getMonth() + 1).padStart(2, '0');
        document.getElementById('con-devolucion-dia').value = dia || String(new Date().getDate()).padStart(2, '0');
        document.getElementById('con-fecha-devolucion').value = c.fechaDevolucion;
    }
    document.getElementById('con-fecha-indefinida').checked = c.fechaDevolucion === 'INDEFINIDO';
    document.getElementById('con-novedades-entrega').value = c.novedadesEntrega || '';
    setEntregaItem('llaves', (c.entregaLlaves || 'NO') === 'SI');
    setEntregaItem('matricula', (c.entregaMatricula || 'NO') === 'SI');
    setFuelLevel(Number(c.nivelGasolina || 0));
    document.getElementById('btn-generar-codigo').disabled = true;
    document.getElementById('btn-generar-codigo').classList.add('is-disabled');
    const visual = document.getElementById('con-codigo-visual');
    if (visual) visual.innerText = c.codigo;
    actualizarEstadoPasosContrato(true, true);
    toggleFechaDevolucionIndefinida(document.getElementById('con-fecha-indefinida').checked);
    contratoPagosTemp = {
        reservaId: dashboardData.reservas.find(item => item.contratoCodigo === c.codigo)?.id || '',
        abonoReserva: Number(c.pagos?.abonoReserva || 0),
        alquiler: {
            total: Number(c.pagos?.alquiler?.total || c.valor || 0),
            pagos: [...((c.pagos?.alquiler?.pagos || []).filter(item => item.medio !== 'Reserva'))]
        },
        deposito: {
            total: Number(c.pagos?.deposito?.total || 0),
            pagos: [...(c.pagos?.deposito?.pagos || [])]
        }
    };
    contratoUltimoCreado = c;
    document.getElementById('btn-imprimir-contrato').disabled = false;
    renderResumenPagosContrato();
}

function inicializarReportes() {
    renderContratosPorClienteSeleccionado();
    mostrarHistorialContratoSeleccionado();
}

function clienteDocDesdeCampo(texto) {
    return texto.includes('|') ? texto.split('|')[1].trim() : '';
}

function renderContratosPorClienteSeleccionado() {
    const select = document.getElementById('rep-contrato');
    if (!select) return;
    const doc = clienteDocDesdeCampo(document.getElementById('rep-cliente')?.value || '');
    const contratos = dbContratos.filter(c => c.arrendatario1.includes(doc) || c.arrendatario2.includes(doc));
    select.innerHTML = '<option value="">Selecciona un contrato</option>' + contratos.map(c => `<option value="${c.codigo}">${c.codigo} Â· ${c.estado}</option>`).join('');
    mostrarHistorialContratoSeleccionado();
}

function guardarReporteMovimiento() {
    const cliente = document.getElementById('rep-cliente').value.trim();
    const contratoCodigo = document.getElementById('rep-contrato').value;
    if (!cliente || !contratoCodigo) return mostrarAlerta('DATOS INCOMPLETOS', 'Selecciona cliente y contrato.');
    const movimiento = {
        id: `mov-${Date.now()}`,
        tipo: document.getElementById('rep-tipo').value,
        cliente,
        contratoCodigo,
        referencia: document.getElementById('rep-referencia').value.trim(),
        valor: document.getElementById('rep-valor').value,
        observacion: document.getElementById('rep-observacion').value.trim(),
        fecha: obtenerFechaHoraActual()
    };
    dbReportes.unshift(movimiento);
    persistirReportes();
    const contrato = dbContratos.find(c => c.codigo === contratoCodigo);
    if (contrato) {
        contrato.historial = contrato.historial || [];
        contrato.historial.push({ fecha: obtenerFechaHoraActual(), detalle: `${movimiento.tipo}: ${movimiento.referencia || 'Movimiento'} por ${movimiento.valor || 0}` });
        persistirContratos();
    }
    mostrarHistorialContratoSeleccionado();
    mostrarAlerta('PROCESO COMPLETADO', 'Movimiento guardado correctamente.');
}

function mostrarHistorialContratoSeleccionado() {
    const contenedor = document.getElementById('historial-contrato');
    if (!contenedor) return;
    const codigo = document.getElementById('rep-contrato')?.value || '';
    const contrato = dbContratos.find(c => c.codigo === codigo);
    if (!contrato) return contenedor.innerHTML = '<div class="dashboard-empty">Selecciona un contrato para ver su historial.</div>';
    const historial = contrato.historial || [];
    contenedor.innerHTML = historial.length ? historial.map(item => `<div class="dashboard-item"><div><strong>${item.detalle}</strong><small>${item.fecha}</small></div></div>`).join('') : '<div class="dashboard-empty">Sin historial.</div>';
}

function inicializarConfiguracion() {
    document.getElementById('config-login-panel').style.display = adminAutenticado ? 'none' : 'block';
    document.getElementById('config-admin-panel').style.display = adminAutenticado ? 'block' : 'none';
    if (adminAutenticado) renderSolicitudes(true);
}

function ingresarConfiguracion() {
    const clave = document.getElementById('config-admin-clave').value;
    if (clave !== adminPassword) return mostrarAlerta('CLAVE INCORRECTA', 'La clave de administrador no es valida.');
    adminAutenticado = true;
    sessionStorage.setItem('rodemos_admin_auth', '1');
    inicializarConfiguracion();
}

function cerrarSesionConfiguracion() {
    adminAutenticado = false;
    sessionStorage.removeItem('rodemos_admin_auth');
    inicializarConfiguracion();
}

function cerrarModales() {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('show'));
    cerrarCamaraDocumento();
    seleccionPendiente = null;
    modoEliminarClientes = false;
    clientesSeleccionadosEliminar = new Set();
}

function mostrarAlerta(titulo, mensaje) {
    document.getElementById('alerta-titulo').innerText = titulo;
    document.getElementById('alerta-mensaje').innerText = mensaje;
    document.getElementById('modal-alerta').classList.add('show');
}

function cerrarAlerta() {
    document.getElementById('modal-alerta').classList.remove('show');
}

function formatearCampoDinero(input) {
    const valor = parseMoneyInput(input.value);
    input.value = valor ? valor.toLocaleString('es-CO') : '';
}

/* Administrative workflow overrides */
let clienteVistaActual = 'rentas';
let motosPaginaActual = 1;
const MOTOS_POR_PAGINA = 18;

function valorCliente(cliente, key, alterno = '') {
    return cliente?.[key] || (alterno ? cliente?.[alterno] : '') || '';
}

function estadoBadge(estado) {
    const activo = String(estado || 'ACTIVO').toUpperCase() !== 'INACTIVO';
    return `<span class="status-pill ${activo ? 'active' : 'inactive'}">${activo ? 'Activo' : 'Inactivo'}</span>`;
}

function normalizarFechaParaMostrar(fecha) {
    if (!fecha) return '-';
    const partes = String(fecha).split('-');
    if (partes.length !== 3) return fecha;
    const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    return `${partes[2]} ${meses[Number(partes[1]) - 1] || partes[1]} ${partes[0]}`;
}

function diasHasta(fecha) {
    if (!fecha) return null;
    const hoy = new Date(`${obtenerFechaHoy()}T00:00:00`);
    const objetivo = new Date(`${fecha}T00:00:00`);
    if (Number.isNaN(objetivo.getTime())) return null;
    return Math.ceil((objetivo - hoy) / 86400000);
}

function pedirClaveAdmin() {
    const clave = window.prompt('Ingresa la clave de administrador');
    if (clave === null) return false;
    if (clave !== adminPassword) {
        mostrarAlerta('CLAVE INCORRECTA', 'La clave de administrador no es valida.');
        return false;
    }
    return true;
}

function renderClientesListado() {
    const tabla = document.getElementById('clientes-listado-body');
    if (!tabla) return;
    const resumen = document.getElementById('clientes-listado-resumen');
    const paginacion = document.getElementById('clientes-listado-paginacion');
    const clientes = obtenerClientesFiltrados();
    const totalPaginas = Math.max(1, Math.ceil(clientes.length / CLIENTES_POR_PAGINA));
    if (clientesPaginaActual > totalPaginas) clientesPaginaActual = totalPaginas;
    const inicio = (clientesPaginaActual - 1) * CLIENTES_POR_PAGINA;
    const pagina = clientes.slice(inicio, inicio + CLIENTES_POR_PAGINA);

    if (resumen) resumen.innerText = `${clientes.length} clientes encontrados. Mostrando ${clientes.length ? inicio + 1 : 0}-${inicio + pagina.length}.`;
    tabla.innerHTML = pagina.length ? pagina.map(({ cliente, idx }) => `<tr>
        <td><b>${cliente.nombre || '-'}</b></td>
        <td>${cliente.doc || '-'}</td>
        <td>${valorCliente(cliente, 'tel', 'telefono1') || '-'}</td>
        <td>${cliente.barrio || '-'}</td>
        <td>${cliente.ciudad || '-'}</td>
        <td>${estadoBadge(cliente.estado)}</td>
        <td>${cliente.email || '-'}</td>
        <td class="doc-actions">
            <button class="btn-listado" onclick="verDetalle(${idx})">Abrir ficha</button>
            <button class="btn-listado danger" onclick="eliminarClientePorIndice(${idx})">Eliminar</button>
        </td>
    </tr>`).join('') : `<tr><td colspan="8" class="cliente-empty-row">No hay clientes con esta busqueda. Puedes crear uno nuevo.</td></tr>`;
    if (paginacion) paginacion.innerHTML = `
        <button class="btn-listado" type="button" onclick="cambiarPaginaClientes(-1)" ${clientesPaginaActual <= 1 ? 'disabled' : ''}>Anterior</button>
        <span class="dashboard-page-label">Pagina ${clientesPaginaActual} de ${totalPaginas}</span>
        <button class="btn-listado" type="button" onclick="cambiarPaginaClientes(1)" ${clientesPaginaActual >= totalPaginas ? 'disabled' : ''}>Siguiente</button>
    `;
}

function eliminarClientePorIndice(idx) {
    const cliente = dbClientes[idx];
    if (!cliente) return;
    if (!pedirClaveAdmin()) return;
    if (!window.confirm(`Eliminar el cliente ${cliente.nombre || cliente.doc}?`)) return;
    dbClientes.splice(idx, 1);
    persistirClientes();
    renderClientesListado();
    mostrarAlerta('CLIENTE ELIMINADO', 'El cliente fue eliminado correctamente.');
}

function llenarCamposCliente(cliente = {}) {
    const mapa = {
        'form-nombre': cliente.nombre || '',
        'form-doc': cliente.doc || '',
        'tipo-id': cliente.tipoId || cliente.tipoID || 'CC',
        email: cliente.email || '',
        tel: cliente.tel || cliente.telefono1 || '',
        tel2: cliente.tel2 || cliente.telefono2 || '',
        dir: cliente.dir || cliente.direccion || '',
        barrio: cliente.barrio || '',
        ciudad: cliente.ciudad || '',
        'dias-alquiler': cliente.diasAlquiler || '',
        estado: cliente.estado || 'ACTIVO'
    };
    Object.keys(mapa).forEach(key => {
        const el = document.getElementById(`cli-${key}`);
        if (el) el.value = mapa[key];
    });
    document.getElementById('cli-nombre').value = mapa['form-nombre'];
    document.getElementById('cli-doc').value = mapa['form-doc'];
}

function setLecturaCliente(readOnly) {
    ['form-nombre', 'form-doc', 'email', 'tel', 'tel2', 'dir', 'barrio', 'ciudad', 'dias-alquiler'].forEach(f => {
        const el = document.getElementById(`cli-${f}`);
        if (el) el.readOnly = readOnly;
    });
    ['tipo-id', 'estado'].forEach(f => {
        const el = document.getElementById(`cli-${f}`);
        if (el) el.disabled = readOnly;
    });
}

function mostrarFormularioNuevo() {
    const nombreActual = document.getElementById('cli-nombre').value.toUpperCase().trim();
    const docActual = document.getElementById('cli-doc').value.trim();
    clienteSeleccionadoIdx = null;
    fotosTemp = {};
    otrosDocsTemp = [];
    limpiarFormularioCliente();
    llenarCamposCliente({ nombre: nombreActual, doc: docActual, estado: 'ACTIVO', tipoId: 'CC' });
    renderizarDocumentosBase();
    renderizarOtrosDocumentos();
    document.getElementById('detalle-completo').style.display = 'flex';
    document.getElementById('cliente-modal-titulo').innerText = 'Crear cliente';
    document.getElementById('btn-principal-crear').style.display = 'none';
    setLecturaCliente(false);
    const btn = document.querySelector('#detalle-completo .btn-action');
    btn.innerText = 'GUARDAR REGISTRO';
    btn.style.background = 'var(--primary-red)';
    btn.onclick = validarYGuardarCliente;
    setEstadoDocumentos(false);
    seleccionarVistaCliente('rentas');
}

function verDetalle(idx) {
    clienteSeleccionadoIdx = idx;
    const c = dbClientes[idx];
    if (!c) return;
    document.getElementById('detalle-completo').style.display = 'flex';
    document.getElementById('cliente-modal-titulo').innerText = 'Ficha del cliente';
    ocultarBusqueda('area-coincidencias', 'btn-principal-crear');
    llenarCamposCliente(c);
    setLecturaCliente(true);
    cargarDocumentosCliente(c);
    setEstadoDocumentos(true);
    const btn = document.querySelector('#detalle-completo .btn-action');
    btn.innerText = 'MODIFICAR CLIENTE';
    btn.style.background = '#7a1c1c';
    btn.onclick = () => {
        setLecturaCliente(false);
        btn.innerText = 'GUARDAR CAMBIOS';
        btn.style.background = 'var(--primary-red)';
        btn.onclick = guardarExistente;
        setEstadoDocumentos(false);
    };
    seleccionarVistaCliente('rentas');
}

function construirClienteDesdeFormulario(base) {
    const nombre = (document.getElementById('cli-form-nombre')?.value || '').toUpperCase().trim();
    const doc = (document.getElementById('cli-form-doc')?.value || '').trim();
    document.getElementById('cli-nombre').value = nombre;
    document.getElementById('cli-doc').value = doc;
    return {
        ...base,
        nombre,
        doc,
        tipoId: document.getElementById('cli-tipo-id')?.value || 'CC',
        email: document.getElementById('cli-email')?.value.trim() || '',
        tel: document.getElementById('cli-tel')?.value.trim() || '',
        tel2: document.getElementById('cli-tel2')?.value.trim() || '',
        dir: document.getElementById('cli-dir')?.value.trim() || '',
        barrio: document.getElementById('cli-barrio')?.value.trim() || '',
        ciudad: document.getElementById('cli-ciudad')?.value.trim() || '',
        diasAlquiler: document.getElementById('cli-dias-alquiler')?.value || '',
        estado: document.getElementById('cli-estado')?.value || 'ACTIVO',
        ...fotosTemp,
        otrosDocs: otrosDocsTemp.map(doc => ({ id: doc.id, titulo: doc.titulo, archivo: doc.archivo }))
    };
}

function seleccionarVistaCliente(vista) {
    clienteVistaActual = vista;
    document.getElementById('cliente-tab-rentas')?.classList.toggle('active', vista === 'rentas');
    document.getElementById('cliente-tab-pagos')?.classList.toggle('active', vista === 'pagos');
    const filtros = document.getElementById('cliente-filtros-pagos');
    if (filtros) filtros.style.display = vista === 'pagos' ? 'grid' : 'none';
    renderHistorialCliente();
}

function contratosDelClienteActual() {
    const cliente = dbClientes[clienteSeleccionadoIdx];
    if (!cliente) return [];
    const doc = String(cliente.doc || '');
    return dbContratos.filter(c => String(c.arrendatario1 || '').includes(doc) || String(c.arrendatario2 || '').includes(doc));
}

function pagosDelClienteActual() {
    return contratosDelClienteActual().flatMap(contrato => {
        const pagos = [];
        (contrato.pagos?.alquiler?.pagos || []).forEach(p => pagos.push({ ...p, concepto: 'ALQUILER', contrato }));
        (contrato.pagos?.deposito?.pagos || []).forEach(p => pagos.push({ ...p, concepto: 'DEPOSITO', contrato }));
        dbReportes.filter(r => r.contratoCodigo === contrato.codigo).forEach(r => pagos.push({ fecha: r.fecha, valor: r.valor, descripcion: r.observacion || r.referencia, medio: r.referencia, concepto: r.tipo, contrato }));
        return pagos;
    });
}

function renderHistorialCliente() {
    const head = document.getElementById('cliente-historial-head');
    const body = document.getElementById('cliente-historial-body');
    if (!head || !body) return;
    if (clienteVistaActual === 'pagos') {
        const desde = document.getElementById('cliente-pago-fecha-desde')?.value || '';
        const hasta = document.getElementById('cliente-pago-fecha-hasta')?.value || '';
        const contratoFiltro = normalizarBusqueda(document.getElementById('cliente-pago-contrato')?.value || '');
        const motoFiltro = normalizarBusqueda(document.getElementById('cliente-pago-moto')?.value || '');
        const valorFiltro = Number(document.getElementById('cliente-pago-valor')?.value || 0);
        let pagos = pagosDelClienteActual().filter(p => {
            const fecha = String(p.fecha || '').slice(0, 10);
            const okFecha = (!desde || fecha >= desde) && (!hasta || fecha <= hasta);
            const okContrato = !contratoFiltro || normalizarBusqueda(p.contrato.codigo).includes(contratoFiltro);
            const okMoto = !motoFiltro || normalizarBusqueda(p.contrato.moto || '').includes(motoFiltro);
            const okValor = !valorFiltro || Number(p.valor || 0) === valorFiltro;
            return okFecha && okContrato && okMoto && okValor;
        });
        head.innerHTML = '<tr><th>Fecha</th><th>Contrato</th><th>Moto</th><th>Concepto</th><th>Medio</th><th>Descripcion</th><th>Valor</th></tr>';
        body.innerHTML = pagos.length ? pagos.map(p => `<tr><td>${p.fecha || '-'}</td><td>${p.contrato.codigo}</td><td>${p.contrato.moto || '-'}</td><td>${p.concepto || '-'}</td><td>${p.medio || '-'}</td><td>${p.descripcion || '-'}</td><td>${Number(p.valor || 0).toLocaleString('es-CO')}</td></tr>`).join('') : '<tr><td colspan="7" class="cliente-empty-row">Sin pagos para estos filtros.</td></tr>';
        return;
    }
    const contratos = contratosDelClienteActual();
    head.innerHTML = '<tr><th>Codigo</th><th>Moto</th><th>Fecha inicio</th><th>Fecha entrega</th><th>Tipo</th><th>Estado</th><th>Revisar</th></tr>';
    body.innerHTML = contratos.length ? contratos.map(c => `<tr><td>${c.codigo}</td><td>${c.moto || '-'}</td><td>${c.fechaInicio || '-'}</td><td>${c.fechaDevolucion || '-'}</td><td>${c.tipoContrato || 'CORTO'}</td><td>${estadoBadge(c.estado)}</td><td><button class="btn-listado" onclick="abrirVistaContratoPorCodigo('${c.codigo}')">Ver</button></td></tr>`).join('') : '<tr><td colspan="7" class="cliente-empty-row">Sin contratos registrados para este cliente.</td></tr>';
}

function inicializarMotos() {
    motoSeleccionadaIdx = null;
    motosPaginaActual = 1;
    limpiarFormularioMoto();
    cerrarFormularioMoto();
    ocultarBusqueda('area-coincidencias-motos', 'btn-principal-crear-moto');
    renderMotosListado();
}

function limpiarFormularioMoto() {
    ['placa', 'form-placa', 'busqueda', 'marca', 'referencia', 'linea', 'clase', 'modelo', 'cilindraje', 'motor', 'chasis', 'color', 'soat', 'tecno'].forEach(f => {
        const el = document.getElementById('mo-' + f);
        if (el) el.value = '';
    });
    motoFotosTemp = {};
    ['matricula', 'lado1', 'lado2', 'tecno', 'soat'].forEach(tipo => {
        const input = document.getElementById(`mo-img-${tipo}`);
        if (input) input.value = '';
        renderPreviewImagenMoto(tipo, null);
    });
    const alerta = document.getElementById('alerta-documentos-moto');
    if (alerta) alerta.style.display = 'none';
}

function obtenerMotosFiltradas() {
    const placa = normalizarBusqueda(document.getElementById('mo-placa')?.value || '');
    const texto = normalizarBusqueda(document.getElementById('mo-busqueda')?.value || '');
    const tokens = texto.split(/\s+/).filter(Boolean);
    return dbMotos.map((moto, idx) => ({ moto, idx })).filter(({ moto }) => {
        const okPlaca = placa ? normalizarBusqueda(moto.placa || '').includes(placa) : true;
        const cuerpo = normalizarBusqueda(`${moto.marca || ''} ${moto.referencia || ''} ${moto.linea || ''} ${moto.modelo || ''}`);
        const okTexto = tokens.length ? tokens.every(token => cuerpo.includes(token)) : true;
        return okPlaca && okTexto;
    }).sort((a, b) => String(a.moto.placa || '').localeCompare(String(b.moto.placa || '')));
}

function buscarMotos() {
    motosPaginaActual = 1;
    renderMotosListado();
    const placa = document.getElementById('mo-placa')?.value.trim();
    const texto = document.getElementById('mo-busqueda')?.value.trim();
    const existen = obtenerMotosFiltradas().length;
    const btnCrear = document.getElementById('btn-principal-crear-moto');
    if (btnCrear) btnCrear.style.display = (placa || texto) && !existen ? 'block' : 'none';
}

function renderMotosListado() {
    const tabla = document.getElementById('motos-listado-body');
    if (!tabla) return;
    const motos = obtenerMotosFiltradas();
    const totalPaginas = Math.max(1, Math.ceil(motos.length / MOTOS_POR_PAGINA));
    if (motosPaginaActual > totalPaginas) motosPaginaActual = totalPaginas;
    const inicio = (motosPaginaActual - 1) * MOTOS_POR_PAGINA;
    const pagina = motos.slice(inicio, inicio + MOTOS_POR_PAGINA);
    const resumen = document.getElementById('motos-listado-resumen');
    if (resumen) resumen.innerText = `${motos.length} motos encontradas. Mostrando ${motos.length ? inicio + 1 : 0}-${inicio + pagina.length}.`;
    tabla.innerHTML = pagina.length ? pagina.map(({ moto, idx }) => `<tr>
        <td><b>${moto.placa || '-'}</b></td><td>${moto.marca || '-'}</td><td>${moto.referencia || '-'}</td><td>${moto.linea || '-'}</td><td>${moto.modelo || '-'}</td>
        <td>${normalizarFechaParaMostrar(moto.vencimientoSoat)}</td><td>${normalizarFechaParaMostrar(moto.vencimientoTecno)}</td><td>${estadoDocumentalMoto(moto)}</td>
        <td class="doc-actions"><button class="btn-listado" onclick="verDetalleMoto(${idx})">Abrir ficha</button><button class="btn-listado danger" onclick="eliminarMotoPorIndice(${idx})">Eliminar</button></td>
    </tr>`).join('') : '<tr><td colspan="9" class="cliente-empty-row">No hay motos con esta busqueda. Puedes crear una nueva.</td></tr>';
    const pag = document.getElementById('motos-listado-paginacion');
    if (pag) pag.innerHTML = `<button class="btn-listado" onclick="cambiarPaginaMotos(-1)" ${motosPaginaActual <= 1 ? 'disabled' : ''}>Anterior</button><span class="dashboard-page-label">Pagina ${motosPaginaActual} de ${totalPaginas}</span><button class="btn-listado" onclick="cambiarPaginaMotos(1)" ${motosPaginaActual >= totalPaginas ? 'disabled' : ''}>Siguiente</button>`;
}

function encabezadosMotosCSV() {
    return ['Placa', 'Marca', 'Referencia moto', 'Linea', 'Clase', 'Modelo', 'Cilindraje', 'Color', 'Motor', 'Chasis', 'Fecha vence tecnomecanica', 'Fecha vence SOAT'];
}

function exportarMotosExcel() {
    const filas = dbMotos.map(moto => [
        moto.placa || '',
        moto.marca || '',
        moto.referencia || '',
        moto.linea || '',
        moto.clase || '',
        moto.modelo || '',
        moto.cilindraje || '',
        moto.color || '',
        moto.motor || '',
        moto.chasis || '',
        moto.vencimientoTecno || '',
        moto.vencimientoSoat || ''
    ]);
    descargarCSV('motos_rodemos.csv', encabezadosMotosCSV(), filas);
}

function descargarPlantillaMotos() {
    descargarCSV('plantilla_motos_rodemos.csv', encabezadosMotosCSV(), [[
        'ABC123', 'YAMAHA', 'NMAX', 'NMAX CONNECTED', 'MOTOCICLETA', '2025', '155', 'NEGRO', 'MOTOR123', 'CHASIS123', '2026-12-31', '2026-12-31'
    ]]);
}

function abrirModalImportarMotos() {
    document.getElementById('modal-importar-motos')?.classList.add('show');
}

function cerrarModalImportarMotos() {
    document.getElementById('modal-importar-motos')?.classList.remove('show');
}

function cargarArchivoMotos() {
    cerrarModalImportarMotos();
    document.getElementById('input-importar-motos')?.click();
}

function construirMotoDesdeFila(encabezados, fila) {
    const mapa = {};
    encabezados.forEach((encabezado, idx) => mapa[encabezado] = fila[idx] || '');
    return {
        placa: String(mapa.placa || '').toUpperCase().trim(),
        marca: String(mapa.marca || '').toUpperCase().trim(),
        referencia: String(mapa.referenciamoto || mapa.referencia || '').toUpperCase().trim(),
        linea: String(mapa.linea || '').toUpperCase().trim(),
        clase: String(mapa.clase || '').toUpperCase().trim(),
        modelo: String(mapa.modelo || '').trim(),
        cilindraje: String(mapa.cilindraje || '').trim(),
        color: String(mapa.color || '').toUpperCase().trim(),
        motor: String(mapa.motor || '').trim(),
        chasis: String(mapa.chasis || '').trim(),
        vencimientoTecno: String(mapa.fechavencetecnomecanica || mapa.tecno || '').trim(),
        vencimientoSoat: String(mapa.fechavencesoat || mapa.soat || '').trim(),
        fotos: {}
    };
}

function importarMotos(input) {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async e => {
        try {
            const filas = parseCSV(String(e.target.result || ''));
            const encabezados = filas[0].map(normalizarEncabezadoImportacion);
            const exportarPendientes = [];
            for (let i = 1; i < filas.length; i++) {
                const fila = filas[i];
                if (!fila.some(col => String(col || '').trim())) continue;
                const moto = construirMotoDesdeFila(encabezados, fila);
                if (!moto.placa) continue;
                const idx = dbMotos.findIndex(item => String(item.placa) === String(moto.placa));
                if (idx >= 0) {
                    dbMotos[idx] = { ...dbMotos[idx], ...moto, fotos: dbMotos[idx].fotos || {} };
                    exportarPendientes.push(idx);
                } else {
                    dbMotos.push(moto);
                    exportarPendientes.push(dbMotos.length - 1);
                }
            }
            for (const idx of exportarPendientes) dbMotos[idx] = await exportarCarpetaMoto(dbMotos[idx], null);
            persistirMotos();
            renderMotosListado();
            mostrarAlerta('MOTOS IMPORTADAS', 'El archivo fue cargado correctamente.');
        } catch {
            mostrarAlerta('ERROR AL IMPORTAR', 'No fue posible leer el archivo CSV de motos.');
        } finally {
            input.value = '';
        }
    };
    reader.readAsText(file, 'utf-8');
}

function cambiarPaginaMotos(delta) {
    motosPaginaActual += delta;
    renderMotosListado();
}

function mostrarFormularioMotoNueva() {
    const placa = document.getElementById('mo-placa').value.toUpperCase().trim();
    motoSeleccionadaIdx = null;
    limpiarFormularioMoto();
    document.getElementById('mo-placa').value = placa;
    document.getElementById('mo-form-placa').value = placa;
    document.getElementById('detalle-moto').style.display = 'flex';
    document.getElementById('moto-modal-titulo').innerText = 'Crear moto';
    document.getElementById('btn-principal-crear-moto').style.display = 'none';
}

function verDetalleMoto(idx) {
    motoSeleccionadaIdx = idx;
    const m = dbMotos[idx];
    if (!m) return;
    document.getElementById('detalle-moto').style.display = 'flex';
    document.getElementById('moto-modal-titulo').innerText = 'Ficha de moto';
    ['placa', 'marca', 'referencia', 'linea', 'clase', 'modelo', 'cilindraje', 'motor', 'chasis', 'color', 'soat', 'tecno'].forEach(f => {
        const key = f === 'soat' ? 'vencimientoSoat' : f === 'tecno' ? 'vencimientoTecno' : f;
        const el = document.getElementById(`mo-${f}`);
        if (el) el.value = m[key] || '';
    });
    document.getElementById('mo-form-placa').value = m.placa || '';
    motoFotosTemp = { ...(m.fotos || {}) };
    ['matricula', 'lado1', 'lado2', 'tecno', 'soat'].forEach(tipo => renderPreviewImagenMoto(tipo, motoFotosTemp[tipo]));
    actualizarAlertaMoto(m);
}

function cerrarFormularioMoto() {
    const modal = document.getElementById('detalle-moto');
    if (modal) modal.style.display = 'none';
    renderMotosListado();
}

function construirMotoDesdeFormulario() {
    const placa = (document.getElementById('mo-form-placa')?.value || document.getElementById('mo-placa')?.value || '').toUpperCase().trim();
    return {
        placa,
        marca: document.getElementById('mo-marca')?.value.toUpperCase().trim() || '',
        referencia: document.getElementById('mo-referencia')?.value.toUpperCase().trim() || '',
        linea: document.getElementById('mo-linea')?.value.toUpperCase().trim() || '',
        clase: document.getElementById('mo-clase')?.value.toUpperCase().trim() || '',
        modelo: document.getElementById('mo-modelo')?.value.trim() || '',
        cilindraje: document.getElementById('mo-cilindraje')?.value.trim() || '',
        motor: document.getElementById('mo-motor')?.value.trim() || '',
        chasis: document.getElementById('mo-chasis')?.value.trim() || '',
        color: document.getElementById('mo-color')?.value.toUpperCase().trim() || '',
        vencimientoSoat: document.getElementById('mo-soat')?.value || '',
        vencimientoTecno: document.getElementById('mo-tecno')?.value || '',
        fotos: { ...motoFotosTemp }
    };
}

async function cargarImagenMoto(tipo, input) {
    const file = input?.files?.[0];
    if (!file) return;
    const documento = await leerArchivoComoDocumento(file, `MOTO-${tipo.toUpperCase()}-${Date.now()}.${obtenerExtension(file)}`);
    motoFotosTemp[tipo] = documento;
    renderPreviewImagenMoto(tipo, documento);
}

function renderPreviewImagenMoto(tipo, documento) {
    const contenedor = document.getElementById(`mo-preview-${tipo}`);
    if (!contenedor) return;
    if (!documento?.dataUrl) {
        contenedor.innerHTML = 'Sin imagen';
        contenedor.classList.remove('has-image');
        return;
    }
    contenedor.classList.add('has-image');
    contenedor.innerHTML = `
        <img src="${documento.dataUrl}" alt="${tipo}">
        <div class="doc-actions">
            <button class="btn-icon" type="button" onclick="abrirArchivo(${JSON.stringify(documento).replace(/"/g, '&quot;')})">Ver</button>
            <button class="btn-icon" type="button" onclick="copiarUnaImagenMoto('${tipo}')">Copiar</button>
        </div>
    `;
}

async function copiarImagenesAlPortapapeles(documentos) {
    const imagenes = documentos.filter(doc => doc?.dataUrl && String(doc.dataUrl).startsWith('data:image/'));
    if (!imagenes.length) return mostrarAlerta('SIN IMAGENES', 'Esta moto no tiene imagenes cargadas para copiar.');
    if (!navigator.clipboard || !window.ClipboardItem) {
        return mostrarAlerta('COPIA NO DISPONIBLE', 'El navegador no permite copiar imagenes directamente. Puedes abrir cada imagen y copiarla manualmente.');
    }
    try {
        const items = [];
        for (const item of imagenes) {
            const blob = await (await fetch(item.dataUrl)).blob();
            items.push(new ClipboardItem({ [blob.type]: blob }));
        }
        await navigator.clipboard.write(items);
        mostrarAlerta('IMAGENES COPIADAS', `Se copiaron ${imagenes.length} imagen(es). Ya puedes ir a WhatsApp y pegarlas.`);
    } catch {
        mostrarAlerta('COPIA NO DISPONIBLE', 'No fue posible copiar directo desde este navegador. Abre la imagen y copiala manualmente.');
    }
}

function copiarImagenesMoto() {
    copiarImagenesAlPortapapeles(['matricula', 'lado1', 'lado2', 'tecno', 'soat'].map(tipo => motoFotosTemp[tipo]));
}

function copiarUnaImagenMoto(tipo) {
    copiarImagenesAlPortapapeles([motoFotosTemp[tipo]]);
}

function estadoDocumentalMoto(moto) {
    const avisos = [];
    [['SOAT', moto.vencimientoSoat], ['Tecno', moto.vencimientoTecno]].forEach(([nombre, fecha]) => {
        const dias = diasHasta(fecha);
        if (dias === null) return;
        if (dias < 0) avisos.push(`${nombre} vencido`);
        else if (dias <= 5) avisos.push(`${nombre} vence en ${dias} dia(s)`);
    });
    return avisos.length ? avisos.join(' / ') : 'AL DIA';
}

function obtenerAlertasVencimientoMotos() {
    return dbMotos.flatMap(moto => [['SOAT', moto.vencimientoSoat], ['Tecnomecanica', moto.vencimientoTecno]].map(([doc, fecha]) => ({ moto, doc, fecha, dias: diasHasta(fecha) }))).filter(item => item.dias !== null && item.dias <= 5);
}

function renderAlertasVencimientos() {
    const card = document.getElementById('panel-alertas-vencimientos');
    const lista = document.getElementById('alertas-vencimientos-lista');
    if (!card || !lista) return;
    const alertas = obtenerAlertasVencimientoMotos();
    if (!card.dataset.abierto) card.style.display = 'none';
    lista.innerHTML = alertas.length ? alertas.map(item => `<div class="dashboard-item"><div><strong>${item.moto.placa || '-'} · ${item.doc}</strong><small>${item.dias < 0 ? 'Vencido' : `Vence en ${item.dias} dia(s)`} · ${normalizarFechaParaMostrar(item.fecha)}</small></div><span class="status-pill ${item.dias < 0 ? 'inactive' : 'warn'}">${item.dias < 0 ? 'Vencido' : 'Proximo'}</span></div>`).join('') : '<div class="dashboard-empty">No hay vencimientos proximos.</div>';
}

function abrirAlertasVencimientos() {
    const card = document.getElementById('panel-alertas-vencimientos');
    if (!card) return;
    card.dataset.abierto = '1';
    card.style.display = 'block';
    renderAlertasVencimientos();
}

function cerrarAlertasVencimientos() {
    const card = document.getElementById('panel-alertas-vencimientos');
    if (!card) return;
    delete card.dataset.abierto;
    card.style.display = 'none';
}

function abrirPanelReservasInicio() {
    const panel = document.getElementById('panel-reservas-inicio');
    if (!panel) return;
    panel.style.display = 'block';
    renderReservas();
}

function cerrarPanelReservasInicio() {
    const panel = document.getElementById('panel-reservas-inicio');
    if (panel) panel.style.display = 'none';
}

function enfocarCentroMensajes() {
    document.getElementById('centro-mensajes')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const renderDashboardOriginal = renderDashboard;
renderDashboard = function() {
    renderDashboardOriginal();
    renderAlertasVencimientos();
};

function fechaEntregaContrato(contrato) {
    return contrato.fechaDevolucion && contrato.fechaDevolucion !== 'INDEFINIDO' ? contrato.fechaDevolucion : '-';
}

function horaEntregaContrato(contrato) {
    return contrato.horaEntrega || contrato.horaDevolucion || '-';
}

function contratosHistorialFiltrados() {
    const busqueda = normalizarBusqueda(document.getElementById('historial-contrato-busqueda')?.value || '');
    const tokens = busqueda.split(/\s+/).filter(Boolean);
    const desde = document.getElementById('historial-contrato-fecha-desde')?.value || '';
    const hasta = document.getElementById('historial-contrato-fecha-hasta')?.value || '';
    const moto = normalizarBusqueda(document.getElementById('historial-contrato-moto')?.value || '');
    const tipo = document.getElementById('historial-contrato-tipo')?.value || '';
    return obtenerContratosIniciales().filter(c => {
        const nombre = normalizarBusqueda(`${c.arrendatario1 || ''} ${c.arrendatario2 || ''}`);
        const okNombre = tokens.length ? tokens.every(token => nombre.includes(token)) : true;
        const okFecha = (!desde || String(c.fechaInicio || '') >= desde) && (!hasta || String(c.fechaInicio || '') <= hasta);
        const okMoto = !moto || normalizarBusqueda(c.moto || '').includes(moto);
        const okTipo = !tipo || String(c.tipoContrato || 'CORTO').toUpperCase() === tipo;
        return okNombre && okFecha && okMoto && okTipo;
    }).sort((a, b) => `${b.fechaInicio || ''} ${b.horaCreacion || ''}`.localeCompare(`${a.fechaInicio || ''} ${a.horaCreacion || ''}`));
}

function renderListaContratos() {
    const lista = document.getElementById('lista-contratos');
    const detalle = document.getElementById('detalle-historial-contrato');
    if (!lista) return;
    const contratos = contratosHistorialFiltrados().slice(0, 20);
    lista.innerHTML = contratos.length ? contratos.map(c => `<tr>
        <td><b>${c.codigo}</b></td>
        <td>${c.arrendatario1 || '-'}</td>
        <td>${c.fechaInicio || '-'}</td>
        <td>${c.horaCreacion || '-'}</td>
        <td>${fechaEntregaContrato(c)}</td>
        <td>${horaEntregaContrato(c)}</td>
        <td>${c.moto || '-'}</td>
        <td><span class="status-pill type">${c.tipoContrato || 'CORTO'}</span></td>
        <td>${estadoBadge(c.estado)}</td>
        <td class="doc-actions">
            <button class="btn-listado" type="button" onclick="verHistorialContratoBase('${c.codigo}')">Ver</button>
            <button class="btn-listado" type="button" onclick="abrirVistaContratoPorCodigo('${c.codigo}')">Revisar</button>
            <button class="btn-listado" type="button" onclick="cambiarTipoContratoConClave('${c.codigo}')">Pasar a ${String(c.tipoContrato || 'CORTO').toUpperCase() === 'CORTO' ? 'largo' : 'corto'}</button>
        </td>
    </tr>`).join('') : '<tr><td colspan="10" class="cliente-empty-row">No se encontraron contratos. Ajusta los filtros o busca por nombre.</td></tr>';
    if (detalle) {
        detalle.style.display = 'none';
        detalle.innerHTML = '';
    }
}

function cambiarTipoContratoConClave(codigo) {
    const contrato = dbContratos.find(c => c.codigo === codigo);
    if (!contrato) return;
    if (!pedirClaveAdmin()) return;
    const actual = String(contrato.tipoContrato || 'CORTO').toUpperCase();
    contrato.tipoContrato = actual === 'CORTO' ? 'LARGO' : 'CORTO';
    contrato.historial = contrato.historial || [];
    contrato.historial.push({ fecha: obtenerFechaHoraActual(), detalle: `Tipo de contrato cambiado a ${contrato.tipoContrato}` });
    persistirContratos();
    renderListaContratos();
    mostrarAlerta('TIPO ACTUALIZADO', `El contrato ${codigo} ahora esta como ${contrato.tipoContrato}.`);
}

function verHistorialContratoBase(codigo) {
    const contrato = dbContratos.find(item => item.codigo === codigo);
    const contenedor = document.getElementById('detalle-historial-contrato');
    if (!contrato || !contenedor) return;
    const eventos = obtenerEventosContratoBase(codigo);
    const pagos = [];
    (contrato.pagos?.alquiler?.pagos || []).forEach(p => pagos.push({ ...p, concepto: 'ALQUILER' }));
    (contrato.pagos?.deposito?.pagos || []).forEach(p => pagos.push({ ...p, concepto: 'DEPOSITO' }));
    contenedor.style.display = 'block';
    contenedor.innerHTML = `
        <div class="dashboard-panel-header" style="margin:0 0 12px;">
            <div>
                <h3>${contrato.codigo} · ${contrato.arrendatario1 || '-'}</h3>
                <p class="dashboard-subtitle">${contrato.moto || '-'} · ${contrato.tipoContrato || 'CORTO'} · ${contrato.estado || 'ACTIVO'}</p>
            </div>
        </div>
        <table class="excel-table">
            <thead><tr><th>Fecha</th><th>Tipo</th><th>Codigo</th><th>Estado</th><th>Detalle</th><th>Revision</th></tr></thead>
            <tbody>
                ${eventos.length ? eventos.map(item => `<tr><td>${item.fecha || '-'}</td><td>${item.tipo || '-'}</td><td>${item.codigo || '-'}</td><td>${estadoBadge(item.estado)}</td><td>${item.detalle || '-'}</td><td><button class="btn-listado" onclick="abrirVistaContratoPorCodigo('${item.codigo || codigo}')">Revisar</button></td></tr>`).join('') : '<tr><td colspan="6">Sin historial asociado.</td></tr>'}
            </tbody>
        </table>
        <div class="excel-container">
            <table class="excel-table">
                <thead><tr><th>Fecha</th><th>Concepto</th><th>Descripcion</th><th>Medio</th><th>Valor</th></tr></thead>
                <tbody>${pagos.length ? pagos.map(p => `<tr><td>${p.fecha || '-'}</td><td>${p.concepto}</td><td>${p.descripcion || '-'}</td><td>${p.medio || '-'}</td><td>${Number(p.valor || 0).toLocaleString('es-CO')}</td></tr>`).join('') : '<tr><td colspan="5">Sin pagos registrados.</td></tr>'}</tbody>
            </table>
        </div>
    `;
}

function inicializarReportes() {
    renderContratosPorClienteSeleccionado();
    mostrarHistorialContratoSeleccionado();
    actualizarResumenReporte();
}

function renderContratosPorClienteSeleccionado() {
    const select = document.getElementById('rep-contrato');
    if (!select) return;
    const doc = clienteDocDesdeCampo(document.getElementById('rep-cliente')?.value || '');
    const contratos = doc
        ? dbContratos.filter(c => String(c.arrendatario1 || '').includes(doc) || String(c.arrendatario2 || '').includes(doc))
        : [];
    select.innerHTML = '<option value="">Selecciona un contrato</option>' + contratos.map(c => `<option value="${c.codigo}">${c.codigo} - ${c.estado || 'ACTIVO'} - ${c.moto || ''}</option>`).join('');
    mostrarHistorialContratoSeleccionado();
    actualizarResumenReporte();
}

function contratoReporteSeleccionado() {
    const codigo = document.getElementById('rep-contrato')?.value || '';
    return dbContratos.find(c => c.codigo === codigo);
}

function saldoContratoReporte(contrato) {
    if (!contrato) return 0;
    const alquiler = contrato.pagos?.alquiler || {};
    const deposito = contrato.pagos?.deposito || {};
    return Number(alquiler.saldo || 0) + Number(deposito.saldo || 0);
}

function actualizarResumenReporte() {
    const tipo = document.getElementById('rep-tipo')?.value || 'PAGO';
    const cliente = document.getElementById('rep-cliente')?.value || 'Sin seleccionar';
    const contrato = contratoReporteSeleccionado();
    const concepto = document.getElementById('rep-concepto')?.value || 'ALQUILER';
    const valor = parseMoneyInput(document.getElementById('rep-valor')?.value || '');
    setTexto('rep-resumen-tipo', tipo);
    setTexto('rep-preview-cliente', cliente || 'Sin seleccionar');
    setTexto('rep-preview-contrato', contrato?.codigo || 'Sin contrato');
    setTexto('rep-preview-concepto', concepto);
    setTexto('rep-preview-valor', valor ? valor.toLocaleString('es-CO') : '0');
    setTexto('rep-preview-saldo', saldoContratoReporte(contrato).toLocaleString('es-CO'));
}

async function guardarReporteMovimiento() {
    const cliente = document.getElementById('rep-cliente').value.trim();
    const contratoCodigo = document.getElementById('rep-contrato').value;
    const valor = parseMoneyInput(document.getElementById('rep-valor').value || '');
    if (!cliente || !contratoCodigo) return mostrarAlerta('DATOS INCOMPLETOS', 'Selecciona cliente y contrato.');
    if (!valor) return mostrarAlerta('VALOR REQUERIDO', 'Ingresa el valor del movimiento.');
    const soporteFile = document.getElementById('rep-soporte')?.files?.[0];
    const soporte = soporteFile ? await leerArchivoComoDocumento(soporteFile, `SOPORTE-${Date.now()}.${obtenerExtension(soporteFile)}`) : null;
    const movimiento = {
        id: `mov-${Date.now()}`,
        tipo: document.getElementById('rep-tipo').value,
        concepto: document.getElementById('rep-concepto')?.value || 'ALQUILER',
        cliente,
        contratoCodigo,
        referencia: document.getElementById('rep-referencia').value.trim(),
        valor,
        observacion: document.getElementById('rep-observacion').value.trim(),
        soporte,
        fecha: obtenerFechaHoraActual()
    };
    dbReportes.unshift(movimiento);
    persistirReportes();
    const contrato = dbContratos.find(c => c.codigo === contratoCodigo);
    if (contrato) {
        contrato.historial = contrato.historial || [];
        contrato.historial.push({ fecha: obtenerFechaHoraActual(), detalle: `${movimiento.tipo} ${movimiento.concepto}: ${movimiento.referencia || 'Movimiento'} por ${movimiento.valor.toLocaleString('es-CO')}` });
        persistirContratos();
    }
    ['rep-referencia', 'rep-valor', 'rep-observacion'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const soporteInput = document.getElementById('rep-soporte');
    if (soporteInput) soporteInput.value = '';
    mostrarHistorialContratoSeleccionado();
    actualizarResumenReporte();
    mostrarAlerta('PROCESO COMPLETADO', 'Movimiento guardado correctamente.');
}

function movimientosReporteFiltrados() {
    const desde = document.getElementById('hist-rep-desde')?.value || '';
    const hasta = document.getElementById('hist-rep-hasta')?.value || '';
    const cliente = normalizarBusqueda(document.getElementById('hist-rep-cliente')?.value || '');
    const contratoFiltro = normalizarBusqueda(document.getElementById('hist-rep-contrato')?.value || '');
    const moto = normalizarBusqueda(document.getElementById('hist-rep-moto')?.value || '');
    const valor = parseMoneyInput(document.getElementById('hist-rep-valor')?.value || '');
    return dbReportes.filter(mov => {
        const contrato = dbContratos.find(c => c.codigo === mov.contratoCodigo);
        const fecha = String(mov.fecha || '').slice(0, 10);
        const okFecha = (!desde || fecha >= desde) && (!hasta || fecha <= hasta);
        const okCliente = !cliente || normalizarBusqueda(mov.cliente || '').includes(cliente);
        const okContrato = !contratoFiltro || normalizarBusqueda(mov.contratoCodigo || '').includes(contratoFiltro);
        const okMoto = !moto || normalizarBusqueda(contrato?.moto || '').includes(moto);
        const okValor = !valor || Number(mov.valor || 0) === valor;
        return okFecha && okCliente && okContrato && okMoto && okValor;
    }).sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
}

function renderHistorialReportes() {
    const body = document.getElementById('historial-reportes-body');
    if (!body) return;
    const movimientos = movimientosReporteFiltrados();
    body.innerHTML = movimientos.length ? movimientos.map(mov => {
        const contrato = dbContratos.find(c => c.codigo === mov.contratoCodigo);
        return `<tr>
            <td>${mov.fecha || '-'}</td>
            <td>${mov.tipo || '-'}</td>
            <td>${mov.cliente || '-'}</td>
            <td>${mov.contratoCodigo || '-'}</td>
            <td>${contrato?.moto || '-'}</td>
            <td>${mov.concepto || '-'}</td>
            <td>${mov.referencia || mov.observacion || '-'}</td>
            <td>${Number(mov.valor || 0).toLocaleString('es-CO')}</td>
            <td>${mov.soporte?.dataUrl ? `<button class="btn-listado" onclick="abrirArchivo(${JSON.stringify(mov.soporte).replace(/"/g, '&quot;')})">Ver</button>` : '-'}</td>
        </tr>`;
    }).join('') : '<tr><td colspan="9" class="cliente-empty-row">No hay movimientos con estos filtros.</td></tr>';
}

function abrirHistorialReportes() {
    document.getElementById('modal-historial-reportes')?.classList.add('show');
    renderHistorialReportes();
}

function cerrarHistorialReportes() {
    document.getElementById('modal-historial-reportes')?.classList.remove('show');
}

function mostrarHistorialContratoSeleccionado() {
    const contenedor = document.getElementById('historial-contrato');
    if (!contenedor) return;
    const codigo = document.getElementById('rep-contrato')?.value || '';
    const contrato = dbContratos.find(c => c.codigo === codigo);
    if (!contrato) return contenedor.innerHTML = '<div class="dashboard-empty">Selecciona un contrato para ver sus movimientos.</div>';
    const movimientos = dbReportes.filter(mov => mov.contratoCodigo === codigo);
    contenedor.innerHTML = movimientos.length ? movimientos.map(mov => `<div class="dashboard-item"><div><strong>${mov.tipo} ${mov.concepto || ''} - ${Number(mov.valor || 0).toLocaleString('es-CO')}</strong><small>${mov.fecha} - ${mov.referencia || mov.observacion || 'Sin referencia'}</small></div>${mov.soporte?.dataUrl ? `<button class="btn-listado" onclick="abrirArchivo(${JSON.stringify(mov.soporte).replace(/"/g, '&quot;')})">Ver soporte</button>` : ''}</div>`).join('') : '<div class="dashboard-empty">Sin movimientos registrados para este contrato.</div>';
}

function inicializarFacturas() {
    normalizarFacturasExistentes();
    generarFacturasRecurrentes(false);
    renderFacturas();
}

function contratosLargosActivos() {
    return obtenerContratosIniciales().filter(c => String(c.tipoContrato || '').toUpperCase() === 'LARGO' && String(c.estado || 'ACTIVO').toUpperCase() !== 'CERRADO');
}

function inicioSemanaActual() {
    const hoy = new Date();
    const dia = hoy.getDay() || 7;
    const inicio = new Date(hoy);
    inicio.setDate(hoy.getDate() - dia + 1);
    inicio.setHours(0, 0, 0, 0);
    return inicio;
}

function formatoFechaISO(fecha) {
    return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
}

function sumarDias(fecha, dias) {
    const nueva = new Date(fecha);
    nueva.setDate(nueva.getDate() + dias);
    return nueva;
}

function valorSemanalContrato(contrato) {
    return Number(contrato.valorSemanal || contrato.valor || contrato.pagos?.alquiler?.total || 0);
}

function facturasContrato(codigo) {
    return dbFacturas.filter(f => f.contratoCodigo === codigo).sort((a, b) => String(b.desde || '').localeCompare(String(a.desde || '')));
}

function estadoFacturaBadge(estado) {
    const valor = String(estado || 'PENDIENTE').toUpperCase();
    const clase = valor === 'PAGADA' ? 'active' : valor === 'VENCIDA' ? 'inactive' : 'warn';
    const texto = valor === 'PAGADA' ? 'Pagada' : valor === 'VENCIDA' ? 'Vencida' : 'Pendiente';
    return `<span class="status-pill ${clase}">${texto}</span>`;
}

function saldoPendienteContratoFactura(codigo) {
    return facturasContrato(codigo).reduce((total, f) => total + Number(f.saldo || 0), 0);
}

function normalizarFacturasExistentes() {
    let cambio = false;
    dbFacturas.forEach(f => {
        const total = Number(f.valor || 0) + Number(f.recargo || 0) + Number(f.saldoAnterior || 0);
        const pagado = Number(f.pagado || 0);
        const saldo = Math.max(0, total - pagado);
        if (f.saldo !== saldo) { f.saldo = saldo; cambio = true; }
        const nuevoEstado = saldo <= 0 ? 'PAGADA' : (String(f.hasta || '') < obtenerFechaHoy() ? 'VENCIDA' : 'PENDIENTE');
        if (f.estado !== nuevoEstado) {
            f.estado = nuevoEstado;
            cambio = true;
        }
    });
    if (cambio) persistirFacturas();
}

function generarFacturasRecurrentes(mostrarMensaje = true) {
    const inicio = inicioSemanaActual();
    const desde = formatoFechaISO(inicio);
    const hasta = formatoFechaISO(sumarDias(inicio, 6));
    let creadas = 0;
    contratosLargosActivos().forEach(contrato => {
        const existe = dbFacturas.some(f => f.contratoCodigo === contrato.codigo && f.desde === desde);
        if (existe) return;
        const saldoAnterior = saldoPendienteContratoFactura(contrato.codigo);
        const consecutivo = facturasContrato(contrato.codigo).length + 1;
        dbFacturas.unshift({
            id: `fac-${Date.now()}-${contrato.codigo}-${consecutivo}`,
            numero: `F-${contrato.codigo}-${String(consecutivo).padStart(3, '0')}`,
            contratoCodigo: contrato.codigo,
            cliente: contrato.arrendatario1 || '',
            moto: contrato.moto || '',
            desde,
            hasta,
            valor: valorSemanalContrato(contrato),
            saldoAnterior,
            recargo: 0,
            pagado: 0,
            saldo: saldoAnterior + valorSemanalContrato(contrato),
            estado: 'PENDIENTE',
            referencia: '',
            soporte: null,
            fechaCreacion: obtenerFechaHoraActual(),
            pagos: []
        });
        creadas++;
    });
    if (creadas) persistirFacturas();
    if (mostrarMensaje) mostrarAlerta('FACTURAS RECURRENTES', creadas ? `Se generaron ${creadas} factura(s) para esta semana.` : 'No habia facturas nuevas por generar esta semana.');
    renderFacturas();
}

function facturasFiltradasContrato(contrato) {
    const estado = document.getElementById('fact-filtro-estado')?.value || '';
    const facturas = facturasContrato(contrato.codigo);
    return estado ? facturas.filter(f => f.estado === estado) : facturas;
}

function renderFacturas() {
    const contratos = contratosLargosActivos();
    const busqueda = normalizarBusqueda(document.getElementById('fact-busqueda')?.value || '');
    const tokens = busqueda.split(/\s+/).filter(Boolean);
    const estadoFiltro = document.getElementById('fact-filtro-estado')?.value || '';
    const filtrados = contratos.filter(c => {
        const texto = normalizarBusqueda(`${c.codigo || ''} ${c.arrendatario1 || ''} ${c.moto || ''}`);
        const okTexto = tokens.length ? tokens.every(t => texto.includes(t)) : true;
        const okEstado = !estadoFiltro || facturasContrato(c.codigo).some(f => f.estado === estadoFiltro);
        return okTexto && okEstado;
    });
    const lista = document.getElementById('facturas-contratos-lista');
    const pendientes = dbFacturas.filter(f => f.estado !== 'PAGADA');
    setTexto('fact-kpi-contratos', String(contratos.length));
    setTexto('fact-kpi-pendientes', String(pendientes.length));
    setTexto('fact-kpi-saldo', pendientes.reduce((t, f) => t + Number(f.saldo || 0), 0).toLocaleString('es-CO'));
    if (lista) {
        lista.innerHTML = filtrados.length ? filtrados.map(c => {
            const saldo = saldoPendienteContratoFactura(c.codigo);
            return `<button class="dashboard-thread ${facturasContratoActual === c.codigo ? 'active' : ''}" onclick="seleccionarContratoFacturas('${c.codigo}')">
                <div class="dashboard-thread-top"><strong>${c.codigo}</strong><span class="status-pill type">LARGO</span></div>
                <small>${c.arrendatario1 || '-'} · ${c.moto || '-'}</small>
                <small>Valor semanal: ${valorSemanalContrato(c).toLocaleString('es-CO')} · Saldo: ${saldo.toLocaleString('es-CO')}</small>
            </button>`;
        }).join('') : '<div class="dashboard-empty">No hay contratos largos activos con estos filtros.</div>';
    }
    if (!facturasContratoActual && filtrados[0]) facturasContratoActual = filtrados[0].codigo;
    renderDetalleFacturas();
}

function seleccionarContratoFacturas(codigo) {
    facturasContratoActual = codigo;
    renderFacturas();
}

function renderDetalleFacturas() {
    const body = document.getElementById('facturas-lista-body');
    if (!body) return;
    const contrato = dbContratos.find(c => c.codigo === facturasContratoActual);
    setTexto('fact-detalle-titulo', contrato ? `Facturas ${contrato.codigo}` : 'Facturas del contrato');
    setTexto('fact-detalle-subtitulo', contrato ? `${contrato.arrendatario1 || '-'} · ${contrato.moto || '-'}` : 'Selecciona un contrato para ver sus semanas de cobro.');
    if (!contrato) {
        body.innerHTML = '<tr><td colspan="9" class="cliente-empty-row">Selecciona un contrato recurrente.</td></tr>';
        return;
    }
    const facturas = facturasFiltradasContrato(contrato);
    body.innerHTML = facturas.length ? facturas.map(f => `<tr>
        <td><b>${f.numero}</b></td>
        <td>${f.desde}</td>
        <td>${f.hasta}</td>
        <td>${f.moto || contrato.moto || '-'}</td>
        <td>${Number(f.valor || 0).toLocaleString('es-CO')}</td>
        <td>${Number(f.saldoAnterior || 0).toLocaleString('es-CO')}</td>
        <td>${Number(f.pagado || 0).toLocaleString('es-CO')}</td>
        <td>${estadoFacturaBadge(f.estado)}</td>
        <td class="doc-actions">
            <button class="btn-listado" type="button" onclick="abrirPagoFactura('${f.id}')">Pago</button>
            <button class="btn-listado" type="button" onclick="verReciboFactura('${f.id}')">Ver</button>
        </td>
    </tr>`).join('') : '<tr><td colspan="9" class="cliente-empty-row">Todavia no hay facturas para este contrato.</td></tr>';
}

function obtenerFactura(id) {
    return dbFacturas.find(f => f.id === id);
}

function abrirPagoFactura(id) {
    const factura = obtenerFactura(id);
    if (!factura) return;
    document.getElementById('modal-pago-factura').dataset.facturaId = id;
    setTexto('fact-pago-subtitulo', `${factura.numero} · saldo ${Number(factura.saldo || 0).toLocaleString('es-CO')}`);
    ['fact-pago-valor', 'fact-pago-recargo', 'fact-pago-referencia'].forEach(idCampo => { const el = document.getElementById(idCampo); if (el) el.value = ''; });
    const soporte = document.getElementById('fact-pago-soporte');
    if (soporte) soporte.value = '';
    document.getElementById('modal-pago-factura')?.classList.add('show');
}

function cerrarModalPagoFactura() {
    document.getElementById('modal-pago-factura')?.classList.remove('show');
}

async function guardarPagoFactura() {
    const modal = document.getElementById('modal-pago-factura');
    const factura = obtenerFactura(modal?.dataset.facturaId || '');
    if (!factura) return;
    const valor = parseMoneyInput(document.getElementById('fact-pago-valor')?.value || '');
    const recargo = parseMoneyInput(document.getElementById('fact-pago-recargo')?.value || '');
    const referencia = document.getElementById('fact-pago-referencia')?.value.trim() || '';
    if (!valor && !recargo) return mostrarAlerta('VALOR REQUERIDO', 'Ingresa el pago recibido o el recargo aplicado.');
    const soporteFile = document.getElementById('fact-pago-soporte')?.files?.[0];
    const soporte = soporteFile ? await leerArchivoComoDocumento(soporteFile, `FACTURA-${factura.numero}.${obtenerExtension(soporteFile)}`) : null;
    factura.recargo = Number(factura.recargo || 0) + recargo;
    factura.pagado = Number(factura.pagado || 0) + valor;
    const total = Number(factura.valor || 0) + Number(factura.saldoAnterior || 0) + Number(factura.recargo || 0);
    factura.saldo = Math.max(0, total - Number(factura.pagado || 0));
    factura.estado = factura.saldo <= 0 ? 'PAGADA' : (String(factura.hasta || '') < obtenerFechaHoy() ? 'VENCIDA' : 'PENDIENTE');
    factura.referencia = referencia;
    factura.soporte = soporte || factura.soporte || null;
    factura.pagos = factura.pagos || [];
    factura.pagos.push({ fecha: obtenerFechaHoraActual(), valor, recargo, referencia, soporte });
    dbReportes.unshift({
        id: `mov-${Date.now()}`,
        tipo: 'PAGO',
        concepto: 'FACTURA SEMANAL',
        cliente: factura.cliente,
        contratoCodigo: factura.contratoCodigo,
        referencia: referencia || factura.numero,
        valor,
        observacion: `Pago factura ${factura.numero}`,
        soporte,
        fecha: obtenerFechaHoraActual()
    });
    persistirFacturas();
    persistirReportes();
    cerrarModalPagoFactura();
    renderFacturas();
    verReciboFactura(factura.id);
}

function construirHtmlReciboFactura(factura) {
    const total = Number(factura.valor || 0) + Number(factura.saldoAnterior || 0) + Number(factura.recargo || 0);
    return `<table class="excel-table"><tbody>
        <tr><th colspan="2">RODEMOS INVERGROUP</th></tr>
        <tr><td>Factura</td><td>${factura.numero}</td></tr>
        <tr><td>Cliente</td><td>${factura.cliente || '-'}</td></tr>
        <tr><td>Contrato</td><td>${factura.contratoCodigo}</td></tr>
        <tr><td>Moto</td><td>${factura.moto || '-'}</td></tr>
        <tr><td>Periodo</td><td>${factura.desde} a ${factura.hasta}</td></tr>
        <tr><td>Valor semana</td><td>${Number(factura.valor || 0).toLocaleString('es-CO')}</td></tr>
        <tr><td>Saldo anterior</td><td>${Number(factura.saldoAnterior || 0).toLocaleString('es-CO')}</td></tr>
        <tr><td>Recargo</td><td>${Number(factura.recargo || 0).toLocaleString('es-CO')}</td></tr>
        <tr><td>Total</td><td>${total.toLocaleString('es-CO')}</td></tr>
        <tr><td>Pagado</td><td>${Number(factura.pagado || 0).toLocaleString('es-CO')}</td></tr>
        <tr><td>Saldo</td><td>${Number(factura.saldo || 0).toLocaleString('es-CO')}</td></tr>
        <tr><td>Estado</td><td>${factura.estado}</td></tr>
    </tbody></table>`;
}

function construirTextoReciboFactura(factura) {
    const total = Number(factura.valor || 0) + Number(factura.saldoAnterior || 0) + Number(factura.recargo || 0);
    return [
        'RODEMOS INVERGROUP',
        `Factura: ${factura.numero}`,
        `Cliente: ${factura.cliente || '-'}`,
        `Contrato: ${factura.contratoCodigo}`,
        `Moto: ${factura.moto || '-'}`,
        `Periodo: ${factura.desde} a ${factura.hasta}`,
        `Valor semana: ${Number(factura.valor || 0).toLocaleString('es-CO')}`,
        `Saldo anterior: ${Number(factura.saldoAnterior || 0).toLocaleString('es-CO')}`,
        `Recargo: ${Number(factura.recargo || 0).toLocaleString('es-CO')}`,
        `Total: ${total.toLocaleString('es-CO')}`,
        `Pagado: ${Number(factura.pagado || 0).toLocaleString('es-CO')}`,
        `Saldo: ${Number(factura.saldo || 0).toLocaleString('es-CO')}`,
        `Estado: ${factura.estado}`
    ].join('\n');
}

function verReciboFactura(id) {
    const factura = obtenerFactura(id);
    const contenedor = document.getElementById('recibo-factura-preview');
    if (!factura || !contenedor) return;
    contenedor.dataset.texto = construirTextoReciboFactura(factura);
    contenedor.innerHTML = construirHtmlReciboFactura(factura);
    document.getElementById('modal-recibo-factura')?.classList.add('show');
}

function cerrarModalReciboFactura() {
    document.getElementById('modal-recibo-factura')?.classList.remove('show');
}

async function copiarTextoReciboFactura() {
    const texto = document.getElementById('recibo-factura-preview')?.dataset.texto || '';
    if (!texto) return;
    try {
        await navigator.clipboard.writeText(texto);
        mostrarAlerta('RECIBO COPIADO', 'El recibo quedo listo para pegarlo en WhatsApp.');
    } catch {
        mostrarAlerta('COPIA MANUAL', texto);
    }
}

/* Recurrent invoices v2 */
function abrirAlertasVencimientos() {
    const card = document.getElementById('panel-alertas-vencimientos');
    if (!card) return;
    card.classList.add('show');
    renderAlertasVencimientos();
}

function cerrarAlertasVencimientos() {
    document.getElementById('panel-alertas-vencimientos')?.classList.remove('show');
}

function abrirPanelReservasInicio() {
    const panel = document.getElementById('panel-reservas-inicio');
    if (!panel) return;
    panel.classList.add('show');
    renderReservas();
}

function cerrarPanelReservasInicio() {
    document.getElementById('panel-reservas-inicio')?.classList.remove('show');
}

function renderAlertasVencimientos() {
    const lista = document.getElementById('alertas-vencimientos-lista');
    if (!lista) return;
    const alertas = obtenerAlertasVencimientoMotos();
    lista.innerHTML = alertas.length ? alertas.map(item => `<div class="dashboard-item"><div><strong>${item.moto.placa || '-'} · ${item.doc}</strong><small>${item.dias < 0 ? 'Vencido' : `Vence en ${item.dias} dia(s)`} · ${normalizarFechaParaMostrar(item.fecha)}</small></div><span class="status-pill ${item.dias < 0 ? 'inactive' : 'warn'}">${item.dias < 0 ? 'Vencido' : 'Proximo'}</span></div>`).join('') : '<div class="dashboard-empty">No hay vencimientos proximos.</div>';
}

function contratosLargosActivos() {
    return obtenerContratosIniciales().filter(c => {
        const tipo = String(c.tipoContrato || 'CORTO').toUpperCase();
        const estado = String(c.estado || 'ACTIVO').toUpperCase();
        return tipo === 'LARGO' && !['CERRADO', 'INACTIVO', 'FINALIZADO'].includes(estado);
    });
}

function normalizarFactura(f) {
    f.pagos = Array.isArray(f.pagos) ? f.pagos : [];
    const pagos = f.pagos.reduce((total, p) => total + Number(p.valor || 0), 0);
    const recargos = f.pagos.reduce((total, p) => total + Number(p.recargo || 0), 0);
    const pagadoLegacy = Number(f.pagado || 0);
    const recargoLegacy = Number(f.recargo || 0);
    f.pagado = Math.max(pagos, pagadoLegacy);
    f.recargo = Math.max(recargos, recargoLegacy);
    f.total = Number(f.valor || 0) + Number(f.saldoAnterior || 0) + Number(f.recargo || 0);
    f.saldo = Number(f.total || 0) - Number(f.pagado || 0);
    f.estado = f.saldo <= 0 ? 'PAGADA' : (String(f.hasta || '') < obtenerFechaHoy() ? 'VENCIDA' : 'PENDIENTE');
    return f;
}

function normalizarFacturasExistentes() {
    dbFacturas.forEach(normalizarFactura);
    persistirFacturas();
}

function facturasContrato(codigo) {
    return dbFacturas.filter(f => f.contratoCodigo === codigo).map(normalizarFactura).sort((a, b) => String(b.desde || '').localeCompare(String(a.desde || '')));
}

function balanceContratoFactura(codigo) {
    const facturas = facturasContrato(codigo);
    if (facturas.length) return facturas.reduce((total, f) => total + Number(f.saldo || 0), 0);
    const contrato = dbContratos.find(c => c.codigo === codigo);
    return deudaContratoBase(contrato);
}

function deudaContratoBase(contrato) {
    if (!contrato) return 0;
    const alquiler = Number(contrato.pagos?.alquiler?.saldo || 0);
    const deposito = Number(contrato.pagos?.deposito?.saldo || 0);
    return alquiler + deposito;
}

function formatoSaldo(valor) {
    const numero = Number(valor || 0);
    if (numero < 0) return `<span class="fact-balance-negative">A favor ${Math.abs(numero).toLocaleString('es-CO')}</span>`;
    if (numero > 0) return `<span class="fact-balance-positive">${numero.toLocaleString('es-CO')}</span>`;
    return '<span>0</span>';
}

function estadoFacturaBadge(estado) {
    const valor = String(estado || 'PENDIENTE').toUpperCase();
    const clase = valor === 'PAGADA' ? 'active' : valor === 'VENCIDA' ? 'inactive' : 'warn';
    const texto = valor === 'PAGADA' ? 'Pagada' : valor === 'VENCIDA' ? 'Vencida' : 'Pendiente';
    return `<span class="status-pill ${clase}">${texto}</span>`;
}

function valorSemanalContrato(contrato) {
    return Number(contrato.valorSemanal || contrato.valor || contrato.pagos?.alquiler?.total || 0);
}

function inicializarFacturas() {
    normalizarFacturasExistentes();
    renderFacturas();
}

function resumenFacturasContrato(codigo) {
    const facturas = facturasContrato(codigo);
    const ultima = facturas[0] || null;
    return {
        ultima,
        saldo: balanceContratoFactura(codigo),
        pagado: facturas.reduce((total, f) => total + Number(f.pagado || 0), 0),
        saldoAnterior: ultima ? Number(ultima.saldoAnterior || 0) : 0,
        valor: ultima ? Number(ultima.valor || 0) : 0
    };
}

function renderFacturas() {
    normalizarFacturasExistentes();
    const contratos = contratosLargosActivos();
    const busqueda = normalizarBusqueda(document.getElementById('fact-busqueda')?.value || '');
    const tokens = busqueda.split(/\s+/).filter(Boolean);
    const estadoFiltro = document.getElementById('fact-filtro-estado')?.value || '';
    const filtrados = contratos.filter(c => {
        const texto = normalizarBusqueda(`${c.codigo || ''} ${c.arrendatario1 || ''} ${c.moto || ''}`);
        const okTexto = tokens.length ? tokens.every(t => texto.includes(t)) : true;
        const okEstado = !estadoFiltro || facturasContrato(c.codigo).some(f => f.estado === estadoFiltro);
        return okTexto && okEstado;
    });
    const pendientes = dbFacturas.map(normalizarFactura).filter(f => f.estado !== 'PAGADA');
    setTexto('fact-kpi-contratos', String(contratos.length));
    setTexto('fact-kpi-pendientes', String(pendientes.length));
    setTexto('fact-kpi-saldo', pendientes.reduce((t, f) => t + Math.max(0, Number(f.saldo || 0)), 0).toLocaleString('es-CO'));
    const body = document.getElementById('facturas-contratos-body');
    if (body) {
        body.innerHTML = filtrados.length ? filtrados.map(c => {
            const r = resumenFacturasContrato(c.codigo);
            return `<tr>
                <td><b>${c.arrendatario1 || '-'}</b></td>
                <td>${c.moto || '-'}</td>
                <td>${c.codigo || '-'}</td>
                <td>${Number(r.valor || valorSemanalContrato(c)).toLocaleString('es-CO')}</td>
                <td>${Number(r.saldoAnterior || 0).toLocaleString('es-CO')}</td>
                <td>${Number(r.pagado || 0).toLocaleString('es-CO')}</td>
                <td>${formatoSaldo(r.saldo)}</td>
                <td><button class="btn-listado" type="button" onclick="seleccionarContratoFacturas('${c.codigo}')">Revisar</button></td>
            </tr>`;
        }).join('') : '<tr><td colspan="8" class="cliente-empty-row">No hay contratos recurrentes con estos filtros.</td></tr>';
    }
    if (facturasContratoActual) renderDetalleFacturas();
}

function seleccionarContratoFacturas(codigo) {
    facturasContratoActual = codigo;
    const card = document.getElementById('facturas-detalle-card');
    if (card) card.style.display = 'block';
    renderDetalleFacturas();
    card?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cerrarDetalleFacturas() {
    facturasContratoActual = '';
    const card = document.getElementById('facturas-detalle-card');
    if (card) card.style.display = 'none';
}

function renderDetalleFacturas() {
    const body = document.getElementById('facturas-lista-body');
    if (!body) return;
    const contrato = dbContratos.find(c => c.codigo === facturasContratoActual);
    if (!contrato) {
        body.innerHTML = '<tr><td colspan="10" class="cliente-empty-row">Selecciona un contrato recurrente.</td></tr>';
        return;
    }
    setTexto('fact-detalle-titulo', `Historial ${contrato.codigo}`);
    setTexto('fact-detalle-subtitulo', `${contrato.arrendatario1 || '-'} · ${contrato.moto || '-'} · saldo ${balanceContratoFactura(contrato.codigo).toLocaleString('es-CO')}`);
    const facturas = facturasContrato(contrato.codigo);
    body.innerHTML = facturas.length ? facturas.map(f => `<tr>
        <td><b>${f.numero}</b></td>
        <td>${f.desde}</td>
        <td>${f.hasta}</td>
        <td>${f.moto || contrato.moto || '-'}</td>
        <td>${Number(f.valor || 0).toLocaleString('es-CO')}</td>
        <td>${Number(f.saldoAnterior || 0).toLocaleString('es-CO')}</td>
        <td>${Number(f.pagado || 0).toLocaleString('es-CO')}</td>
        <td>${formatoSaldo(f.saldo)}</td>
        <td>${estadoFacturaBadge(f.estado)}</td>
        <td class="doc-actions">
            <button class="btn-listado" type="button" onclick="abrirPagoFactura('${f.id}')">Reportar pago</button>
            <button class="btn-listado" type="button" onclick="abrirPagoFactura('${f.id}')">Generar cobro</button>
            <button class="btn-listado" type="button" onclick="verReciboFactura('${f.id}')">Ver</button>
        </td>
    </tr>`).join('') : '<tr><td colspan="10" class="cliente-empty-row">Todavia no hay facturas. Genera la primera factura de este contrato.</td></tr>';
}

function siguientePeriodoContrato(contrato) {
    const facturas = facturasContrato(contrato.codigo);
    if (facturas.length) {
        const siguienteDesde = sumarDias(new Date(`${facturas[0].hasta}T00:00:00`), 1);
        return { desde: formatoFechaISO(siguienteDesde), hasta: formatoFechaISO(sumarDias(siguienteDesde, 6)) };
    }
    const inicio = contrato.fechaInicio ? new Date(`${contrato.fechaInicio}T00:00:00`) : new Date();
    return { desde: formatoFechaISO(inicio), hasta: formatoFechaISO(sumarDias(inicio, 6)) };
}

function abrirGenerarFacturaSeleccionada() {
    const contrato = dbContratos.find(c => c.codigo === facturasContratoActual);
    if (!contrato) return mostrarAlerta('CONTRATO REQUERIDO', 'Primero selecciona un contrato recurrente.');
    const periodo = siguientePeriodoContrato(contrato);
    const saldo = balanceContratoFactura(contrato.codigo);
    setTexto('fact-generar-subtitulo', `${contrato.arrendatario1 || '-'} · ${contrato.moto || '-'} · ${contrato.codigo}`);
    document.getElementById('fact-generar-desde').value = periodo.desde;
    document.getElementById('fact-generar-hasta').value = periodo.hasta;
    document.getElementById('fact-generar-valor').value = valorSemanalContrato(contrato).toLocaleString('es-CO');
    document.getElementById('fact-generar-saldo').value = saldo.toLocaleString('es-CO');
    document.getElementById('modal-generar-factura')?.classList.add('show');
}

function cerrarModalGenerarFactura() {
    document.getElementById('modal-generar-factura')?.classList.remove('show');
}

function generarFacturasRecurrentes() {
    abrirGenerarFacturaSeleccionada();
}

function generarFacturaContratoSeleccionado() {
    const contrato = dbContratos.find(c => c.codigo === facturasContratoActual);
    if (!contrato) return;
    const desde = document.getElementById('fact-generar-desde')?.value || '';
    const hasta = document.getElementById('fact-generar-hasta')?.value || '';
    const valor = parseMoneyInput(document.getElementById('fact-generar-valor')?.value || '');
    if (!desde || !hasta || !valor) return mostrarAlerta('DATOS INCOMPLETOS', 'Completa fechas y valor de cobro.');
    if (dbFacturas.some(f => f.contratoCodigo === contrato.codigo && f.desde === desde && f.hasta === hasta)) {
        return mostrarAlerta('FACTURA EXISTENTE', 'Ya existe una factura con ese periodo para este contrato.');
    }
    const consecutivo = facturasContrato(contrato.codigo).length + 1;
    const saldoAnterior = balanceContratoFactura(contrato.codigo);
    dbFacturas.unshift({
        id: `fac-${Date.now()}-${contrato.codigo}-${consecutivo}`,
        numero: `F-${contrato.codigo}-${String(consecutivo).padStart(3, '0')}`,
        contratoCodigo: contrato.codigo,
        cliente: contrato.arrendatario1 || '',
        moto: contrato.moto || '',
        desde,
        hasta,
        valor,
        saldoAnterior,
        recargo: 0,
        pagado: 0,
        total: valor + saldoAnterior,
        saldo: valor + saldoAnterior,
        estado: 'PENDIENTE',
        fechaCreacion: obtenerFechaHoraActual(),
        pagos: []
    });
    persistirFacturas();
    cerrarModalGenerarFactura();
    seleccionarContratoFacturas(contrato.codigo);
    mostrarAlerta('FACTURA GENERADA', `Se genero la siguiente factura del contrato ${contrato.codigo}.`);
}

function abrirPagoFactura(id) {
    const factura = obtenerFactura(id);
    if (!factura) return;
    document.getElementById('modal-pago-factura').dataset.facturaId = id;
    setTexto('fact-pago-subtitulo', `${factura.numero} · saldo ${Number(factura.saldo || 0).toLocaleString('es-CO')}`);
    document.getElementById('fact-pago-fecha').value = obtenerFechaHoy();
    ['fact-pago-valor', 'fact-pago-recargo', 'fact-pago-referencia'].forEach(idCampo => { const el = document.getElementById(idCampo); if (el) el.value = ''; });
    const medio = document.getElementById('fact-pago-medio');
    if (medio) medio.value = 'Efectivo';
    const soporte = document.getElementById('fact-pago-soporte');
    if (soporte) soporte.value = '';
    document.getElementById('modal-pago-factura')?.classList.add('show');
}

async function guardarPagoFactura() {
    const modal = document.getElementById('modal-pago-factura');
    const factura = obtenerFactura(modal?.dataset.facturaId || '');
    if (!factura) return;
    const valor = parseMoneyInput(document.getElementById('fact-pago-valor')?.value || '');
    const recargo = parseMoneyInput(document.getElementById('fact-pago-recargo')?.value || '');
    const referencia = document.getElementById('fact-pago-referencia')?.value.trim() || '';
    const medio = document.getElementById('fact-pago-medio')?.value || 'Efectivo';
    const fechaPago = document.getElementById('fact-pago-fecha')?.value || obtenerFechaHoy();
    if (!valor && !recargo) return mostrarAlerta('VALOR REQUERIDO', 'Ingresa el pago recibido o el recargo aplicado.');
    const soporteFile = document.getElementById('fact-pago-soporte')?.files?.[0];
    const soporte = soporteFile ? await leerArchivoComoDocumento(soporteFile, `FACTURA-${factura.numero}-${Date.now()}.${obtenerExtension(soporteFile)}`) : null;
    const movimiento = { id: `fp-${Date.now()}`, fecha: fechaPago, registrado: obtenerFechaHoraActual(), valor, recargo, medio, referencia, soporte };
    factura.pagos = Array.isArray(factura.pagos) ? factura.pagos : [];
    factura.pagos.push(movimiento);
    normalizarFactura(factura);
    dbReportes.unshift({
        id: `mov-${Date.now()}`,
        tipo: valor ? 'PAGO' : 'COBRO',
        concepto: recargo ? 'RECARGO FACTURA' : 'FACTURA SEMANAL',
        cliente: factura.cliente,
        contratoCodigo: factura.contratoCodigo,
        referencia: referencia || factura.numero,
        valor: valor || recargo,
        observacion: `${valor ? 'Pago' : 'Cobro'} factura ${factura.numero}`,
        soporte,
        fecha: fechaPago
    });
    persistirFacturas();
    persistirReportes();
    cerrarModalPagoFactura();
    renderFacturas();
    verReciboFactura(factura.id, movimiento.id);
}

function construirHtmlReciboFactura(factura, movimientoId = '') {
    normalizarFactura(factura);
    const movimientos = factura.pagos || [];
    const movimiento = movimientos.find(p => p.id === movimientoId) || movimientos[movimientos.length - 1] || null;
    return `<div class="pos-receipt">
        <div class="pos-receipt-head">
            <strong>RODEMOS</strong>
            <span>Recibo POS · ${factura.numero}</span>
        </div>
        <div class="pos-receipt-body">
            <div class="pos-receipt-line"><span>Cliente</span><b>${factura.cliente || '-'}</b></div>
            <div class="pos-receipt-line"><span>Contrato</span><b>${factura.contratoCodigo}</b></div>
            <div class="pos-receipt-line"><span>Moto</span><b>${factura.moto || '-'}</b></div>
            <div class="pos-receipt-line"><span>Periodo</span><b>${factura.desde} / ${factura.hasta}</b></div>
            <div class="pos-receipt-line"><span>Cobro semana</span><b>${Number(factura.valor || 0).toLocaleString('es-CO')}</b></div>
            <div class="pos-receipt-line"><span>Saldo anterior</span><b>${Number(factura.saldoAnterior || 0).toLocaleString('es-CO')}</b></div>
            <div class="pos-receipt-line"><span>Recargos</span><b>${Number(factura.recargo || 0).toLocaleString('es-CO')}</b></div>
            <div class="pos-receipt-line"><span>Pagado total</span><b>${Number(factura.pagado || 0).toLocaleString('es-CO')}</b></div>
            <div class="pos-receipt-line total"><span>Saldo</span><b>${Number(factura.saldo || 0).toLocaleString('es-CO')}</b></div>
            ${movimiento ? `<div class="pos-receipt-payments"><b>Movimiento seleccionado</b>
                <div class="pos-receipt-line"><span>Fecha pago</span><b>${movimiento.fecha || '-'}</b></div>
                <div class="pos-receipt-line"><span>Medio</span><b>${movimiento.medio || '-'}</b></div>
                <div class="pos-receipt-line"><span>Pago</span><b>${Number(movimiento.valor || 0).toLocaleString('es-CO')}</b></div>
                <div class="pos-receipt-line"><span>Recargo</span><b>${Number(movimiento.recargo || 0).toLocaleString('es-CO')}</b></div>
            </div>` : ''}
            <div class="pos-receipt-payments">
                <b>Movimientos de la factura</b>
                <table>
                    <thead><tr><th>Fecha</th><th>Medio</th><th>Pago</th><th>Recargo</th><th></th></tr></thead>
                    <tbody>${movimientos.length ? movimientos.map(p => `<tr><td>${p.fecha || '-'}</td><td>${p.medio || '-'}</td><td>${Number(p.valor || 0).toLocaleString('es-CO')}</td><td>${Number(p.recargo || 0).toLocaleString('es-CO')}</td><td><button class="btn-icon" onclick="verReciboFactura('${factura.id}', '${p.id}')">Ver</button></td></tr>`).join('') : '<tr><td colspan="5">Sin pagos o recargos registrados.</td></tr>'}</tbody>
                </table>
            </div>
        </div>
    </div>`;
}

function construirTextoReciboFactura(factura, movimientoId = '') {
    normalizarFactura(factura);
    const movimiento = (factura.pagos || []).find(p => p.id === movimientoId) || (factura.pagos || [])[factura.pagos.length - 1] || {};
    return [
        'RODEMOS INVERGROUP',
        `Recibo POS: ${factura.numero}`,
        `Cliente: ${factura.cliente || '-'}`,
        `Contrato: ${factura.contratoCodigo}`,
        `Moto: ${factura.moto || '-'}`,
        `Periodo: ${factura.desde} a ${factura.hasta}`,
        `Cobro semana: ${Number(factura.valor || 0).toLocaleString('es-CO')}`,
        `Saldo anterior: ${Number(factura.saldoAnterior || 0).toLocaleString('es-CO')}`,
        `Recargos: ${Number(factura.recargo || 0).toLocaleString('es-CO')}`,
        `Pagado total: ${Number(factura.pagado || 0).toLocaleString('es-CO')}`,
        `Saldo: ${Number(factura.saldo || 0).toLocaleString('es-CO')}`,
        movimiento.id ? `Movimiento: ${movimiento.fecha || ''} · ${movimiento.medio || ''} · pago ${Number(movimiento.valor || 0).toLocaleString('es-CO')} · recargo ${Number(movimiento.recargo || 0).toLocaleString('es-CO')}` : ''
    ].filter(Boolean).join('\n');
}

function verReciboFactura(id, movimientoId = '') {
    const factura = obtenerFactura(id);
    const contenedor = document.getElementById('recibo-factura-preview');
    if (!factura || !contenedor) return;
    contenedor.dataset.texto = construirTextoReciboFactura(factura, movimientoId);
    contenedor.innerHTML = construirHtmlReciboFactura(factura, movimientoId);
    document.getElementById('modal-recibo-factura')?.classList.add('show');
}

function renderContratosPorClienteSeleccionado() {
    const select = document.getElementById('rep-contrato');
    if (!select) return;
    const doc = clienteDocDesdeCampo(document.getElementById('rep-cliente')?.value || '');
    const contratos = doc
        ? dbContratos.filter(c => (String(c.arrendatario1 || '').includes(doc) || String(c.arrendatario2 || '').includes(doc)) && String(c.tipoContrato || 'CORTO').toUpperCase() !== 'LARGO')
        : [];
    select.innerHTML = '<option value="">Selecciona un contrato corto</option>' + contratos.map(c => `<option value="${c.codigo}">${c.codigo} - ${c.estado || 'ACTIVO'} - ${c.moto || ''}</option>`).join('');
    mostrarHistorialContratoSeleccionado();
    actualizarResumenReporte();
}

async function guardarReporteMovimiento() {
    const cliente = document.getElementById('rep-cliente').value.trim();
    const contratoCodigo = document.getElementById('rep-contrato').value;
    const contrato = dbContratos.find(c => c.codigo === contratoCodigo);
    const valor = parseMoneyInput(document.getElementById('rep-valor').value || '');
    if (!cliente || !contratoCodigo) return mostrarAlerta('DATOS INCOMPLETOS', 'Selecciona cliente y contrato.');
    if (String(contrato?.tipoContrato || 'CORTO').toUpperCase() === 'LARGO') return mostrarAlerta('CONTRATO RECURRENTE', 'Los contratos largos se pagan desde Facturas recurrentes.');
    if (!valor) return mostrarAlerta('VALOR REQUERIDO', 'Ingresa el valor del movimiento.');
    const soporteFile = document.getElementById('rep-soporte')?.files?.[0];
    const soporte = soporteFile ? await leerArchivoComoDocumento(soporteFile, `SOPORTE-${Date.now()}.${obtenerExtension(soporteFile)}`) : null;
    const movimiento = {
        id: `mov-${Date.now()}`,
        tipo: document.getElementById('rep-tipo').value,
        concepto: document.getElementById('rep-concepto')?.value || 'ALQUILER',
        cliente,
        contratoCodigo,
        referencia: document.getElementById('rep-referencia').value.trim(),
        valor,
        observacion: document.getElementById('rep-observacion').value.trim(),
        soporte,
        fecha: obtenerFechaHoraActual()
    };
    dbReportes.unshift(movimiento);
    persistirReportes();
    if (contrato) {
        contrato.historial = contrato.historial || [];
        contrato.historial.push({ fecha: obtenerFechaHoraActual(), detalle: `${movimiento.tipo} ${movimiento.concepto}: ${movimiento.referencia || 'Movimiento'} por ${movimiento.valor.toLocaleString('es-CO')}` });
        persistirContratos();
    }
    ['rep-referencia', 'rep-valor', 'rep-observacion'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const soporteInput = document.getElementById('rep-soporte');
    if (soporteInput) soporteInput.value = '';
    mostrarHistorialContratoSeleccionado();
    actualizarResumenReporte();
    mostrarAlerta('PROCESO COMPLETADO', 'Movimiento guardado correctamente.');
}

function saldoClienteSistema(cliente) {
    const doc = String(cliente?.doc || '');
    if (!doc) return 0;
    return obtenerContratosIniciales()
        .filter(c => String(c.arrendatario1 || '').includes(doc) || String(c.arrendatario2 || '').includes(doc))
        .reduce((total, c) => total + (String(c.tipoContrato || 'CORTO').toUpperCase() === 'LARGO' ? balanceContratoFactura(c.codigo) : saldoContratoReporte(c)), 0);
}

function renderClientesListado() {
    const tabla = document.getElementById('clientes-listado-body');
    if (!tabla) return;
    const resumen = document.getElementById('clientes-listado-resumen');
    const paginacion = document.getElementById('clientes-listado-paginacion');
    const clientes = obtenerClientesFiltrados();
    const totalPaginas = Math.max(1, Math.ceil(clientes.length / CLIENTES_POR_PAGINA));
    if (clientesPaginaActual > totalPaginas) clientesPaginaActual = totalPaginas;
    const inicio = (clientesPaginaActual - 1) * CLIENTES_POR_PAGINA;
    const pagina = clientes.slice(inicio, inicio + CLIENTES_POR_PAGINA);
    if (resumen) resumen.innerText = `${clientes.length} clientes encontrados. Mostrando ${clientes.length ? inicio + 1 : 0}-${inicio + pagina.length}.`;
    tabla.innerHTML = pagina.length ? pagina.map(({ cliente, idx }) => `<tr>
        <td><b>${cliente.nombre || '-'}</b></td>
        <td>${cliente.doc || '-'}</td>
        <td>${valorCliente(cliente, 'tel', 'telefono1') || '-'}</td>
        <td>${cliente.barrio || '-'}</td>
        <td>${cliente.ciudad || '-'}</td>
        <td>${estadoBadge(cliente.estado)}</td>
        <td>${formatoSaldo(saldoClienteSistema(cliente))}</td>
        <td>${cliente.email || '-'}</td>
        <td class="doc-actions">
            <button class="btn-listado" onclick="verDetalle(${idx})">Abrir ficha</button>
            <button class="btn-listado danger" onclick="eliminarClientePorIndice(${idx})">Eliminar</button>
        </td>
    </tr>`).join('') : `<tr><td colspan="9" class="cliente-empty-row">No hay clientes con esta busqueda. Puedes crear uno nuevo.</td></tr>`;
    if (paginacion) paginacion.innerHTML = `
        <button class="btn-listado" type="button" onclick="cambiarPaginaClientes(-1)" ${clientesPaginaActual <= 1 ? 'disabled' : ''}>Anterior</button>
        <span class="dashboard-page-label">Pagina ${clientesPaginaActual} de ${totalPaginas}</span>
        <button class="btn-listado" type="button" onclick="cambiarPaginaClientes(1)" ${clientesPaginaActual >= totalPaginas ? 'disabled' : ''}>Siguiente</button>
    `;
}

function emitirSonidoMensaje() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        gain.gain.setValueAtTime(0.001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.24);
    } catch {}
}

function renderResumenDashboard() {
    const reservasPendientes = obtenerReservasPendientes();
    const pendientesAsesora = dashboardData.solicitudes.reduce((total, item) => total + Number(item.unreadAsesora || 0), 0);
    const alertasReales = obtenerVencimientosMotos(true);
    setTexto('resumen-reservas-hoy', String(reservasPendientes.length));
    setTexto('resumen-mensajes-pendientes', String(pendientesAsesora));
    setTexto('resumen-alertas-vencimientos', String(alertasReales.length));
    const inicioBtn = document.querySelector('.nav-btn[data-page="inicio"]');
    if (inicioBtn) {
        inicioBtn.classList.toggle('has-message', pendientesAsesora > 0);
        inicioBtn.dataset.badge = pendientesAsesora > 9 ? '9+' : String(pendientesAsesora || '');
    }
    const alertCard = document.querySelector('.dashboard-summary-alert');
    if (alertCard) {
        alertCard.classList.toggle('pulse-alert', alertasReales.length > 0);
        if (alertasReales.length > 0) {
            alertCard.classList.remove('pulse-alert');
            void alertCard.offsetWidth;
            alertCard.classList.add('pulse-alert');
        }
    }
}

const responderSolicitudBase = responderSolicitud;
responderSolicitud = async function(event, autor) {
    await responderSolicitudBase(event, autor);
    if (autor === 'admin') emitirSonidoMensaje();
    renderResumenDashboard();
};

function seleccionarVistaReservas(vista) {
    reservasVistaActual = vista;
    reservasPaginaActual = 1;
    renderReservas();
}

function fechaHoraReservaMs(item) {
    return new Date(`${item.fecha || '1900-01-01'}T${item.hora || '00:00'}`).getTime();
}

function esReservaPendiente(item) {
    if (String(item.estado || 'PENDIENTE').toUpperCase() === 'FINALIZADA') return false;
    return fechaHoraReservaMs(item) >= new Date().setHours(0, 0, 0, 0);
}

function obtenerReservasPendientes() {
    return [...dashboardData.reservas]
        .filter(esReservaPendiente)
        .sort((a, b) => fechaHoraReservaMs(a) - fechaHoraReservaMs(b));
}

function obtenerReservasFinalizadas() {
    return [...dashboardData.reservas]
        .filter(item => !esReservaPendiente(item))
        .sort((a, b) => fechaHoraReservaMs(b) - fechaHoraReservaMs(a));
}

function renderReservas() {
    const contenedor = document.getElementById('reserva-lista');
    const etiqueta = document.getElementById('reserva-rango');
    if (!contenedor || !etiqueta) return;
    const pendientes = reservasVistaActual !== 'finalizadas';
    document.getElementById('btn-reservas-pendientes')?.classList.toggle('active', pendientes);
    document.getElementById('btn-reservas-finalizadas')?.classList.toggle('active', !pendientes);
    const reservas = pendientes ? obtenerReservasPendientes() : obtenerReservasFinalizadas();
    etiqueta.innerText = pendientes ? 'Reservas pendientes ordenadas por la mas proxima.' : 'Reservas finalizadas o vencidas.';
    if (!reservas.length) {
        contenedor.innerHTML = `<div class="dashboard-empty">No hay reservas ${pendientes ? 'pendientes' : 'finalizadas'}.</div>`;
    } else {
        contenedor.innerHTML = reservas.slice(0, 8).map((item, idx) => `
            <div class="dashboard-item dashboard-item-reserva ${idx === 0 && pendientes ? 'next-reservation' : ''}">
                <div>
                    <strong>${idx === 0 && pendientes ? 'PROXIMA · ' : ''}${item.cliente}</strong>
                    <small>${item.fecha} · ${item.hora} · ${item.tipo}${item.moto ? ` · ${item.moto}` : ''}${item.abono ? ` · Abono: ${item.abono}` : ''}</small>
                </div>
                <div class="doc-actions">
                    <button class="btn-icon" onclick="editarReserva('${item.id}')">Abrir</button>
                    <button class="btn-icon" onclick="toggleEstadoReserva('${item.id}')">${pendientes ? 'Finalizar' : 'Reactivar'}</button>
                    <button class="btn-icon danger" onclick="eliminarReservaConClave('${item.id}')">Eliminar</button>
                    <button class="btn-icon" onclick="verReciboReserva('${item.id}')">Recibo</button>
                    ${item.soporte?.dataUrl ? `<button class="btn-icon" onclick="abrirArchivo(${JSON.stringify(item.soporte).replace(/"/g, '&quot;')})">Soporte</button>` : ''}
                </div>
            </div>
        `).join('');
    }
    renderReservasFuturas();
}

function renderReservasFuturas() {
    const body = document.getElementById('reservas-futuras-body');
    const paginacion = document.getElementById('reservas-paginacion');
    if (!body || !paginacion) return;
    const reservas = reservasVistaActual === 'finalizadas' ? obtenerReservasFinalizadas() : obtenerReservasPendientes();
    if (!reservas.length) {
        body.innerHTML = '<tr><td colspan="9" class="dashboard-empty">No hay reservas para mostrar.</td></tr>';
        paginacion.innerHTML = '';
        return;
    }
    const porPagina = 10;
    const total = Math.ceil(reservas.length / porPagina);
    reservasPaginaActual = Math.min(Math.max(reservasPaginaActual, 1), total);
    const pagina = reservas.slice((reservasPaginaActual - 1) * porPagina, reservasPaginaActual * porPagina);
    body.innerHTML = pagina.map(item => `<tr class="${item === reservas[0] && reservasVistaActual !== 'finalizadas' ? 'next-reservation-row' : ''}">
        <td>${item.fecha}</td>
        <td>${item.hora}</td>
        <td>${item.cliente}</td>
        <td>${item.tipo}</td>
        <td>${item.moto || '-'}</td>
        <td>${item.abono || '-'}</td>
        <td>${item.contratoCodigo || '-'}</td>
        <td>${item.soporte?.fileName ? `<button class="btn-icon" onclick="abrirArchivo(${JSON.stringify(item.soporte).replace(/"/g, '&quot;')})">Ver</button>` : '-'}</td>
        <td>
            <div class="doc-actions">
                <button class="btn-icon" onclick="editarReserva('${item.id}')">Abrir</button>
                <button class="btn-icon" onclick="toggleEstadoReserva('${item.id}')">${reservasVistaActual === 'finalizadas' ? 'Reactivar' : 'Finalizar'}</button>
                <button class="btn-icon danger" onclick="eliminarReservaConClave('${item.id}')">Eliminar</button>
                <button class="btn-icon" onclick="verReciboReserva('${item.id}')">Recibo</button>
            </div>
        </td>
    </tr>`).join('');
    paginacion.innerHTML = `
        <button class="btn-icon" onclick="cambiarPaginaReservas(-1)" ${reservasPaginaActual === 1 ? 'disabled' : ''}>Anterior</button>
        <span class="dashboard-page-label">Pagina ${reservasPaginaActual} de ${total}</span>
        <button class="btn-icon" onclick="cambiarPaginaReservas(1)" ${reservasPaginaActual === total ? 'disabled' : ''}>Siguiente</button>
    `;
}

function toggleEstadoReserva(id) {
    const reserva = obtenerReserva(id);
    if (!reserva) return;
    reserva.estado = esReservaPendiente(reserva) ? 'FINALIZADA' : 'PENDIENTE';
    persistirDashboard();
    renderDashboard();
}

function eliminarReservaConClave(id) {
    const reserva = obtenerReserva(id);
    if (!reserva) return;
    if (!pedirClaveAdmin()) return;
    if (!window.confirm(`Eliminar la reserva de ${reserva.cliente || 'cliente'}?`)) return;
    dashboardData.reservas = dashboardData.reservas.filter(item => item.id !== id);
    persistirDashboard();
    renderDashboard();
}

function motoPlacaDesdeTexto(texto) {
    return String(texto || '').split('|')[0].trim().toUpperCase();
}

function reservasQueChocanMoto(placa, fechaInicio, fechaFin) {
    if (!placa || !fechaInicio) return [];
    const inicio = String(fechaInicio);
    const fin = fechaFin && fechaFin !== 'INDEFINIDO' ? String(fechaFin) : inicio;
    return obtenerReservasPendientes().filter(r => {
        const placaReserva = motoPlacaDesdeTexto(r.moto);
        return placaReserva === placa && String(r.fecha || '') >= inicio && String(r.fecha || '') <= fin;
    });
}

function mostrarAlertaReservaMoto(placa) {
    const fechaInicio = document.getElementById('con-fecha-inicio')?.value || obtenerFechaHoy();
    const fechaFin = document.getElementById('con-fecha-devolucion')?.value || fechaInicio;
    const choques = reservasQueChocanMoto(placa, fechaInicio, fechaFin);
    if (choques.length) {
        mostrarAlerta('MOTO RESERVADA', `La moto ${placa} tiene ${choques.length} reserva(s) que coinciden con estas fechas. Revisa reservas antes de crear el contrato.`);
    }
}

const confirmarSeleccionEntidadBaseReserva = confirmarSeleccionEntidad;
confirmarSeleccionEntidad = function(tipo, destino, id) {
    confirmarSeleccionEntidadBaseReserva(tipo, destino, id);
    if (tipo === 'moto' && destino === 'moto') mostrarAlertaReservaMoto(String(id).toUpperCase());
};

function obtenerVencimientosMotos(soloAlertas = false) {
    const docs = [];
    dbMotos.forEach(moto => {
        [['SOAT', moto.vencimientoSoat], ['Tecnomecanica', moto.vencimientoTecno]].forEach(([doc, fecha]) => {
            const dias = diasHasta(fecha);
            let estado = 'AL DIA';
            if (dias === null) estado = 'SIN FECHA';
            else if (dias < 0) estado = 'VENCIDO';
            else if (dias <= 5) estado = 'PROXIMO';
            if (!soloAlertas || estado === 'VENCIDO' || estado === 'PROXIMO') docs.push({ moto, doc, fecha, dias, estado });
        });
    });
    return docs;
}

function obtenerAlertasVencimientoMotos() {
    return obtenerVencimientosMotos(true);
}

function renderAlertasVencimientos() {
    const lista = document.getElementById('alertas-vencimientos-lista');
    if (!lista) return;
    const items = obtenerVencimientosMotos(false);
    lista.innerHTML = items.length ? items.map(item => {
        const clase = item.estado === 'VENCIDO' ? 'inactive' : item.estado === 'PROXIMO' ? 'warn' : 'active';
        const detalle = item.estado === 'SIN FECHA' ? 'Sin fecha cargada' : item.estado === 'AL DIA' ? `Al dia · ${normalizarFechaParaMostrar(item.fecha)}` : item.estado === 'VENCIDO' ? `Vencido · ${normalizarFechaParaMostrar(item.fecha)}` : `Vence en ${item.dias} dia(s) · ${normalizarFechaParaMostrar(item.fecha)}`;
        return `<div class="dashboard-item"><div><strong>${item.moto.placa || '-'} · ${item.doc}</strong><small>${detalle}</small></div><span class="status-pill ${clase}">${item.estado}</span></div>`;
    }).join('') : '<div class="dashboard-empty">No hay motos registradas.</div>';
}

let adminClaveCallback = null;

function pedirClaveAdminModal(mensaje, onOk) {
    adminClaveCallback = onOk;
    const modal = document.getElementById('modal-clave-admin');
    const input = document.getElementById('admin-key-input');
    const texto = document.getElementById('admin-key-message');
    if (texto) texto.innerText = mensaje || 'Confirma la clave de administrador para continuar.';
    if (input) input.value = '';
    modal?.classList.add('show');
    setTimeout(() => input?.focus(), 50);
}

function cerrarModalClaveAdmin() {
    document.getElementById('modal-clave-admin')?.classList.remove('show');
    adminClaveCallback = null;
}

function confirmarModalClaveAdmin() {
    const input = document.getElementById('admin-key-input');
    const clave = input?.value || '';
    if (clave !== adminPassword) return mostrarAlerta('CLAVE INCORRECTA', 'La clave de administrador no es valida.');
    const callback = adminClaveCallback;
    cerrarModalClaveAdmin();
    if (typeof callback === 'function') callback();
}

function eliminarClientePorIndice(idx) {
    const cliente = dbClientes[idx];
    if (!cliente) return;
    pedirClaveAdminModal(`Eliminar el cliente ${cliente.nombre || cliente.doc}.`, () => {
        dbClientes.splice(idx, 1);
        persistirClientes();
        renderClientesListado();
        mostrarAlerta('CLIENTE ELIMINADO', 'El cliente fue eliminado correctamente.');
    });
}

function eliminarClientesSeleccionados() {
    if (!clientesSeleccionadosEliminar.size) return mostrarAlerta('SIN SELECCION', 'Selecciona uno o varios clientes para eliminar.');
    pedirClaveAdminModal('Eliminar los clientes seleccionados.', () => {
        dbClientes = dbClientes.filter(cliente => !clientesSeleccionadosEliminar.has(String(cliente.doc)));
        persistirClientes();
        clientesSeleccionadosEliminar = new Set();
        modoEliminarClientes = false;
        abrirListado();
        mostrarAlerta('CLIENTES ELIMINADOS', 'Los clientes seleccionados fueron eliminados correctamente.');
    });
}

function eliminarReservaConClave(id) {
    const reserva = obtenerReserva(id);
    if (!reserva) return;
    pedirClaveAdminModal(`Eliminar la reserva de ${reserva.cliente || 'cliente'}.`, () => {
        dashboardData.reservas = dashboardData.reservas.filter(item => item.id !== id);
        persistirDashboard();
        renderDashboard();
        mostrarAlerta('RESERVA ELIMINADA', 'La reserva fue eliminada correctamente.');
    });
}

function eliminarMotoPorIndice(idx) {
    const moto = dbMotos[idx];
    if (!moto) return;
    pedirClaveAdminModal(`Eliminar la moto ${moto.placa || ''}.`, () => {
        dbMotos.splice(idx, 1);
        persistirMotos();
        renderMotosListado();
        mostrarAlerta('MOTO ELIMINADA', 'La moto fue eliminada correctamente.');
    });
}

async function actualizarRutaAdministracion() {
    const label = document.getElementById('config-ruta-actual');
    if (!label) return;
    try {
        const handle = await leerHandleGuardado();
        const texto = handle?.name ? `${handle.name} / clientes - motos - contratos` : 'Sin ruta seleccionada';
        label.innerText = texto;
        const modal = document.getElementById('config-ruta-modal');
        if (modal) modal.innerText = texto;
    } catch {
        label.innerText = 'Sin ruta seleccionada';
    }
}

function inicializarConfiguracion() {
    document.getElementById('config-login-panel').style.display = adminAutenticado ? 'none' : 'block';
    document.getElementById('config-admin-panel').style.display = adminAutenticado ? 'block' : 'none';
    if (adminAutenticado) {
        renderSolicitudes(true);
        actualizarRutaAdministracion();
    }
}

async function seleccionarRutaAdministracion() {
    if (!window.showDirectoryPicker) return mostrarAlerta('NO DISPONIBLE', 'Tu navegador no permite seleccionar carpetas.');
    const handle = await seleccionarCarpetaBase();
    if (!handle) return;
    await prepararCarpetasBase();
    actualizarRutaAdministracion();
}

function abrirModalSeguridadAdmin() {
    document.getElementById('modal-seguridad-admin')?.classList.add('show');
}

function cerrarModalSeguridadAdmin() {
    document.getElementById('modal-seguridad-admin')?.classList.remove('show');
}

function abrirModalRutaAdmin() {
    actualizarRutaAdministracion();
    document.getElementById('modal-ruta-admin')?.classList.add('show');
}

function cerrarModalRutaAdmin() {
    document.getElementById('modal-ruta-admin')?.classList.remove('show');
}

function cambiarClaveAdministrador() {
    const actual = document.getElementById('config-clave-actual')?.value || '';
    const nueva = document.getElementById('config-clave-nueva')?.value || '';
    if (actual !== adminPassword) return mostrarAlerta('CLAVE INCORRECTA', 'La clave actual no es valida.');
    if (!nueva || nueva.length < 4) return mostrarAlerta('CLAVE MUY CORTA', 'Usa una clave de al menos 4 caracteres.');
    adminPassword = nueva;
    localStorage.setItem(ADMIN_PASSWORD_KEY, nueva);
    document.getElementById('config-clave-actual').value = '';
    document.getElementById('config-clave-nueva').value = '';
    cerrarModalSeguridadAdmin();
    mostrarAlerta('CLAVE ACTUALIZADA', 'La clave de administrador fue cambiada correctamente.');
}

function inicializarConfiguracion() {
    const login = document.getElementById('config-login-panel');
    const panel = document.getElementById('config-admin-panel');
    if (login) login.style.display = adminAutenticado ? 'none' : 'block';
    if (panel) panel.style.display = adminAutenticado ? 'block' : 'none';
    if (adminAutenticado) actualizarRutaAdministracion();
}

function abrirModalImportarClientes() {
    document.getElementById('modal-importar-clientes')?.classList.add('show');
}

function cerrarModalImportarClientes() {
    document.getElementById('modal-importar-clientes')?.classList.remove('show');
}

function cargarArchivoClientes() {
    cerrarModalImportarClientes();
    document.getElementById('input-importar-clientes')?.click();
}

function prepararImportacionClientes() {
    abrirModalImportarClientes();
}

let telefonoIndicativoDestino = '';

function abrirModalIndicativo(inputId) {
    telefonoIndicativoDestino = inputId;
    const input = document.getElementById('telefono-indicativo-valor');
    if (input) input.value = '+57';
    document.getElementById('modal-indicativo-telefono')?.classList.add('show');
    setTimeout(() => input?.focus(), 50);
}

function cerrarModalIndicativo() {
    document.getElementById('modal-indicativo-telefono')?.classList.remove('show');
    telefonoIndicativoDestino = '';
}

function aplicarIndicativoTelefono() {
    const campo = document.getElementById(telefonoIndicativoDestino);
    const indicativo = document.getElementById('telefono-indicativo-valor')?.value.trim() || '+57';
    if (!campo) return cerrarModalIndicativo();
    const limpio = String(campo.value || '').replace(/^\+\d+\s*/, '').trim();
    campo.value = `${indicativo.startsWith('+') ? indicativo : `+${indicativo}`} ${limpio}`.trim();
    cerrarModalIndicativo();
}

function autoConfirmarClaveAdmin() {
    const input = document.getElementById('admin-key-input');
    if (input && input.value === adminPassword) confirmarModalClaveAdmin();
}

function autoIngresarConfiguracion() {
    const input = document.getElementById('config-admin-clave');
    if (input && input.value === adminPassword) ingresarConfiguracion();
}

function recalcularFacturasContrato(codigo) {
    const facturas = dbFacturas
        .filter(f => f.contratoCodigo === codigo)
        .sort((a, b) => String(a.desde || '').localeCompare(String(b.desde || '')));
    let saldoAnterior = 0;
    facturas.forEach(f => {
        f.pagos = Array.isArray(f.pagos) ? f.pagos : [];
        f.pagos.forEach((p, idx) => {
            if (!p.reciboCodigo) p.reciboCodigo = generarCodigoReciboFactura(f, idx + 1);
        });
        f.pagado = f.pagos.reduce((total, p) => total + Number(p.valor || 0), 0);
        f.recargo = f.pagos.reduce((total, p) => total + Number(p.recargo || 0), 0);
        f.saldoAnterior = saldoAnterior;
        f.total = Number(f.valor || 0) + Number(f.recargo || 0) + Number(f.saldoAnterior || 0);
        f.saldo = Number(f.total || 0) - Number(f.pagado || 0);
        f.estado = f.saldo <= 0 ? 'PAGADA' : (String(f.hasta || '') < obtenerFechaHoy() ? 'VENCIDA' : 'PENDIENTE');
        saldoAnterior = f.saldo;
    });
}

function recalcularTodasFacturas() {
    [...new Set(dbFacturas.map(f => f.contratoCodigo).filter(Boolean))].forEach(recalcularFacturasContrato);
    persistirFacturas();
}

function normalizarFactura(f) {
    f.pagos = Array.isArray(f.pagos) ? f.pagos : [];
    return f;
}

function normalizarFacturasExistentes() {
    recalcularTodasFacturas();
}

function facturasContrato(codigo) {
    recalcularFacturasContrato(codigo);
    return dbFacturas.filter(f => f.contratoCodigo === codigo).sort((a, b) => String(b.desde || '').localeCompare(String(a.desde || '')));
}

function balanceContratoFactura(codigo) {
    recalcularFacturasContrato(codigo);
    const facturas = dbFacturas.filter(f => f.contratoCodigo === codigo);
    if (facturas.length) return facturas.reduce((total, f) => total + Number(f.saldo || 0), 0);
    const contrato = dbContratos.find(c => c.codigo === codigo);
    return deudaContratoBase(contrato);
}

function resumenFacturasContrato(codigo) {
    const facturas = facturasContrato(codigo);
    const ultima = facturas[0] || null;
    const saldo = balanceContratoFactura(codigo);
    return {
        ultima,
        saldo,
        cobroFactura: saldo,
        pagado: facturas.reduce((total, f) => total + Number(f.pagado || 0), 0),
        saldoAnterior: ultima ? Number(ultima.saldoAnterior || 0) : 0,
        valor: ultima ? Number(ultima.valor || 0) : 0
    };
}

function renderFacturas() {
    recalcularTodasFacturas();
    const contratos = contratosLargosActivos();
    const busqueda = normalizarBusqueda(document.getElementById('fact-busqueda')?.value || '');
    const tokens = busqueda.split(/\s+/).filter(Boolean);
    const estadoFiltro = document.getElementById('fact-filtro-estado')?.value || '';
    const filtrados = contratos.filter(c => {
        const texto = normalizarBusqueda(`${c.codigo || ''} ${c.arrendatario1 || ''} ${c.moto || ''}`);
        const okTexto = tokens.length ? tokens.every(t => texto.includes(t)) : true;
        const okEstado = !estadoFiltro || facturasContrato(c.codigo).some(f => f.estado === estadoFiltro);
        return okTexto && okEstado;
    });
    const pendientes = dbFacturas.filter(f => f.estado !== 'PAGADA');
    setTexto('fact-kpi-contratos', String(contratos.length));
    setTexto('fact-kpi-pendientes', String(pendientes.length));
    setTexto('fact-kpi-saldo', pendientes.reduce((t, f) => t + Math.max(0, Number(f.saldo || 0)), 0).toLocaleString('es-CO'));
    const body = document.getElementById('facturas-contratos-body');
    if (body) {
        body.innerHTML = filtrados.length ? filtrados.map(c => {
            const r = resumenFacturasContrato(c.codigo);
            return `<tr>
                <td><b>${c.arrendatario1 || '-'}</b></td>
                <td>${c.moto || '-'}</td>
                <td>${c.codigo || '-'}</td>
                <td>${Number(r.cobroFactura || 0).toLocaleString('es-CO')}</td>
                <td>${Number(r.saldoAnterior || 0).toLocaleString('es-CO')}</td>
                <td>${Number(r.pagado || 0).toLocaleString('es-CO')}</td>
                <td>${formatoSaldo(r.saldo)}</td>
                <td><button class="btn-listado" type="button" onclick="seleccionarContratoFacturas('${c.codigo}')">Revisar</button></td>
            </tr>`;
        }).join('') : '<tr><td colspan="8" class="cliente-empty-row">No hay contratos recurrentes con estos filtros.</td></tr>';
    }
    if (facturasContratoActual) renderDetalleFacturas();
}

function renderDetalleFacturas() {
    const body = document.getElementById('facturas-lista-body');
    if (!body) return;
    const contrato = dbContratos.find(c => c.codigo === facturasContratoActual);
    if (!contrato) {
        body.innerHTML = '<tr><td colspan="10" class="cliente-empty-row">Selecciona un contrato recurrente.</td></tr>';
        return;
    }
    recalcularFacturasContrato(contrato.codigo);
    setTexto('fact-detalle-titulo', `Historial ${contrato.codigo}`);
    setTexto('fact-detalle-subtitulo', `${contrato.arrendatario1 || '-'} | ${contrato.moto || '-'} | saldo ${balanceContratoFactura(contrato.codigo).toLocaleString('es-CO')}`);
    const facturas = facturasContrato(contrato.codigo);
    body.innerHTML = facturas.length ? facturas.map(f => `<tr>
        <td><b>${f.numero}</b></td>
        <td>${normalizarFechaParaMostrar(f.desde)}</td>
        <td>${normalizarFechaParaMostrar(f.hasta)}</td>
        <td>${f.moto || contrato.moto || '-'}</td>
        <td>${Number(f.valor || 0).toLocaleString('es-CO')}</td>
        <td>${Number(f.saldoAnterior || 0).toLocaleString('es-CO')}</td>
        <td>${Number(f.pagado || 0).toLocaleString('es-CO')}</td>
        <td>${formatoSaldo(f.saldo)}</td>
        <td>${estadoFacturaBadge(f.estado)}</td>
        <td class="doc-actions">
            <button class="btn-listado" type="button" onclick="abrirPagoFactura('${f.id}')">Reportar pago</button>
            <button class="btn-listado" type="button" onclick="abrirPagoFactura('${f.id}')">Generar cobro</button>
            <button class="btn-listado" type="button" onclick="verReciboFactura('${f.id}')">Ver</button>
        </td>
    </tr>`).join('') : '<tr><td colspan="10" class="cliente-empty-row">Todavia no hay facturas. Genera la primera factura de este contrato.</td></tr>';
}

function generarFacturaContratoSeleccionado() {
    const contrato = dbContratos.find(c => c.codigo === facturasContratoActual);
    if (!contrato) return;
    const desde = document.getElementById('fact-generar-desde')?.value || '';
    const hasta = document.getElementById('fact-generar-hasta')?.value || '';
    const valor = parseMoneyInput(document.getElementById('fact-generar-valor')?.value || '');
    if (!desde || !hasta || !valor) return mostrarAlerta('DATOS INCOMPLETOS', 'Completa fechas y valor de cobro.');
    if (dbFacturas.some(f => f.contratoCodigo === contrato.codigo && f.desde === desde && f.hasta === hasta)) {
        return mostrarAlerta('FACTURA EXISTENTE', 'Ya existe una factura con ese periodo para este contrato.');
    }
    recalcularFacturasContrato(contrato.codigo);
    const consecutivo = dbFacturas.filter(f => f.contratoCodigo === contrato.codigo).length + 1;
    const saldoAnterior = balanceContratoFactura(contrato.codigo);
    dbFacturas.unshift({
        id: `fac-${Date.now()}-${contrato.codigo}-${consecutivo}`,
        numero: `F-${contrato.codigo}-${String(consecutivo).padStart(3, '0')}`,
        contratoCodigo: contrato.codigo,
        cliente: contrato.arrendatario1 || '',
        moto: contrato.moto || '',
        desde,
        hasta,
        valor,
        saldoAnterior,
        recargo: 0,
        pagado: 0,
        total: valor + saldoAnterior,
        saldo: valor + saldoAnterior,
        estado: 'PENDIENTE',
        fechaCreacion: obtenerFechaHoraActual(),
        pagos: []
    });
    recalcularFacturasContrato(contrato.codigo);
    persistirFacturas();
    cerrarModalGenerarFactura();
    seleccionarContratoFacturas(contrato.codigo);
    renderClientesListado();
    mostrarAlerta('FACTURA GENERADA', `Se genero la siguiente factura del contrato ${contrato.codigo}.`);
}

function generarCodigoReciboFactura(factura, consecutivo = 1) {
    const base = String(factura?.numero || 'FACT').replace(/[^A-Z0-9]/gi, '').slice(-10);
    return `RC-${base}-${String(consecutivo).padStart(3, '0')}-${Date.now().toString().slice(-5)}`;
}

async function guardarPagoFactura() {
    const modal = document.getElementById('modal-pago-factura');
    const factura = obtenerFactura(modal?.dataset.facturaId || '');
    if (!factura) return;
    const valor = parseMoneyInput(document.getElementById('fact-pago-valor')?.value || '');
    const recargo = parseMoneyInput(document.getElementById('fact-pago-recargo')?.value || '');
    const referencia = document.getElementById('fact-pago-referencia')?.value.trim() || '';
    const medio = document.getElementById('fact-pago-medio')?.value || 'Efectivo';
    const fechaPago = document.getElementById('fact-pago-fecha')?.value || obtenerFechaHoy();
    if (!valor && !recargo) return mostrarAlerta('VALOR REQUERIDO', 'Ingresa el pago recibido o el recargo aplicado.');
    const soporteFile = document.getElementById('fact-pago-soporte')?.files?.[0];
    const soporte = soporteFile ? await leerArchivoComoDocumento(soporteFile, `FACTURA-${factura.numero}-${Date.now()}.${obtenerExtension(soporteFile)}`) : null;
    factura.pagos = Array.isArray(factura.pagos) ? factura.pagos : [];
    const movimiento = {
        id: `fp-${Date.now()}`,
        reciboCodigo: generarCodigoReciboFactura(factura, factura.pagos.length + 1),
        fecha: fechaPago,
        registrado: obtenerFechaHoraActual(),
        valor,
        recargo,
        medio,
        referencia,
        soporte
    };
    factura.pagos.push(movimiento);
    recalcularFacturasContrato(factura.contratoCodigo);
    dbReportes.unshift({
        id: `mov-${Date.now()}`,
        tipo: valor ? 'PAGO' : 'COBRO',
        concepto: recargo ? 'RECARGO FACTURA' : 'FACTURA SEMANAL',
        cliente: factura.cliente,
        contratoCodigo: factura.contratoCodigo,
        facturaId: factura.id,
        reciboCodigo: movimiento.reciboCodigo,
        referencia: referencia || factura.numero,
        valor: valor || recargo,
        observacion: `${valor ? 'Pago' : 'Cobro'} factura ${factura.numero}`,
        soporte,
        fecha: fechaPago
    });
    persistirFacturas();
    persistirReportes();
    cerrarModalPagoFactura();
    renderFacturas();
    renderClientesListado();
    verReciboFactura(factura.id, movimiento.id);
}

function qrMiniHtml(codigo) {
    const chars = String(codigo || 'RODEMOS');
    let seed = 0;
    for (let i = 0; i < chars.length; i++) seed = (seed + chars.charCodeAt(i) * (i + 3)) % 9973;
    return `<div class="receipt-qr">${Array.from({ length: 169 }, (_, i) => {
        const finder = (i < 39 && i % 13 < 3) || (i < 39 && i % 13 > 9) || (i > 129 && i % 13 < 3);
        const on = finder || ((seed + i * 17 + Math.floor(i / 13) * 11) % 5 < 2);
        return `<span class="${on ? 'on' : ''}"></span>`;
    }).join('')}</div>`;
}

function construirHtmlReciboFactura(factura, movimientoId = '') {
    recalcularFacturasContrato(factura.contratoCodigo);
    const movimientos = factura.pagos || [];
    const movimiento = movimientos.find(p => p.id === movimientoId) || movimientos[movimientos.length - 1] || null;
    const codigo = movimiento?.reciboCodigo || generarCodigoReciboFactura(factura, movimientos.length || 1);
    return `<div class="pos-receipt">
        <div class="pos-receipt-head">
            <strong>RODEMOS</strong>
            <span>Recibo POS</span>
            <div class="receipt-code-row">${codigo}</div>
        </div>
        <div class="pos-receipt-body">
            <div class="pos-receipt-line"><span>Cliente</span><b>${factura.cliente || '-'}</b></div>
            <div class="pos-receipt-line"><span>Contrato</span><b>${factura.contratoCodigo}</b></div>
            <div class="pos-receipt-line"><span>Factura</span><b>${factura.numero}</b></div>
            <div class="pos-receipt-line"><span>Moto</span><b>${factura.moto || '-'}</b></div>
            <div class="pos-receipt-line"><span>Periodo</span><b>${normalizarFechaParaMostrar(factura.desde)} / ${normalizarFechaParaMostrar(factura.hasta)}</b></div>
            <div class="pos-receipt-line"><span>Fecha pago</span><b>${normalizarFechaParaMostrar(movimiento?.fecha || obtenerFechaHoy())}</b></div>
            <div class="pos-receipt-line"><span>Medio</span><b>${movimiento?.medio || '-'}</b></div>
            <div class="pos-receipt-line"><span>Referencia</span><b>${movimiento?.referencia || '-'}</b></div>
            <div class="pos-receipt-line"><span>Pago</span><b>${Number(movimiento?.valor || 0).toLocaleString('es-CO')}</b></div>
            <div class="pos-receipt-line"><span>Recargo</span><b>${Number(movimiento?.recargo || 0).toLocaleString('es-CO')}</b></div>
            <div class="pos-receipt-line total"><span>Saldo factura</span><b>${Number(factura.saldo || 0).toLocaleString('es-CO')}</b></div>
            ${qrMiniHtml(codigo)}
        </div>
    </div>`;
}

function dibujarReciboCanvas(factura, movimientoId = '') {
    recalcularFacturasContrato(factura.contratoCodigo);
    const movimientos = factura.pagos || [];
    const movimiento = movimientos.find(p => p.id === movimientoId) || movimientos[movimientos.length - 1] || {};
    const codigo = movimiento.reciboCodigo || generarCodigoReciboFactura(factura, movimientos.length || 1);
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 1220;
    canvas.className = 'receipt-canvas-preview';
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#3a0d12';
    ctx.fillRect(0, 0, canvas.width, 190);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 48px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('RODEMOS', 450, 76);
    ctx.font = '24px Arial';
    ctx.fillText('RECIBO POS', 450, 118);
    ctx.fillText(codigo, 450, 154);
    const filas = [
        ['Cliente', factura.cliente || '-'],
        ['Contrato', factura.contratoCodigo || '-'],
        ['Factura', factura.numero || '-'],
        ['Moto', factura.moto || '-'],
        ['Periodo', `${normalizarFechaParaMostrar(factura.desde)} / ${normalizarFechaParaMostrar(factura.hasta)}`],
        ['Fecha pago', normalizarFechaParaMostrar(movimiento.fecha || obtenerFechaHoy())],
        ['Medio', movimiento.medio || '-'],
        ['Referencia', movimiento.referencia || '-'],
        ['Pago', Number(movimiento.valor || 0).toLocaleString('es-CO')],
        ['Recargo', Number(movimiento.recargo || 0).toLocaleString('es-CO')],
        ['Saldo factura', Number(factura.saldo || 0).toLocaleString('es-CO')]
    ];
    ctx.textAlign = 'left';
    let y = 250;
    filas.forEach(([label, value], idx) => {
        ctx.fillStyle = idx === filas.length - 1 ? '#d32f2f' : '#6b7280';
        ctx.font = idx === filas.length - 1 ? 'bold 30px Arial' : '24px Arial';
        ctx.fillText(label, 70, y);
        ctx.fillStyle = idx === filas.length - 1 ? '#d32f2f' : '#111827';
        ctx.font = idx === filas.length - 1 ? 'bold 32px Arial' : 'bold 24px Arial';
        const texto = String(value);
        ctx.fillText(texto.length > 34 ? texto.slice(0, 34) + '...' : texto, 330, y);
        ctx.strokeStyle = '#e5e7eb';
        ctx.beginPath();
        ctx.moveTo(70, y + 24);
        ctx.lineTo(830, y + 24);
        ctx.stroke();
        y += 68;
    });
    let seed = 0;
    for (let i = 0; i < codigo.length; i++) seed = (seed + codigo.charCodeAt(i) * (i + 3)) % 9973;
    const size = 16;
    const startX = 346;
    const startY = 940;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(startX - 20, startY - 20, size * 13 + 40, size * 13 + 40);
    for (let r = 0; r < 13; r++) {
        for (let c = 0; c < 13; c++) {
            const i = r * 13 + c;
            const finder = (r < 3 && c < 3) || (r < 3 && c > 9) || (r > 9 && c < 3);
            const on = finder || ((seed + i * 17 + r * 11) % 5 < 2);
            ctx.fillStyle = on ? '#111827' : '#f1f5f9';
            ctx.fillRect(startX + c * size, startY + r * size, size - 2, size - 2);
        }
    }
    ctx.fillStyle = '#6b7280';
    ctx.font = '20px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Comprobante generado por Rodemos Invergroup', 450, 1190);
    return canvas;
}

function verReciboFactura(id, movimientoId = '') {
    const factura = obtenerFactura(id);
    const contenedor = document.getElementById('recibo-factura-preview');
    if (!factura || !contenedor) return;
    contenedor.innerHTML = '';
    contenedor.dataset.facturaId = id;
    contenedor.dataset.movimientoId = movimientoId;
    contenedor.appendChild(dibujarReciboCanvas(factura, movimientoId));
    document.getElementById('modal-recibo-factura')?.classList.add('show');
}

async function copiarTextoReciboFactura() {
    const canvas = document.querySelector('#recibo-factura-preview canvas');
    if (!canvas) return;
    try {
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        mostrarAlerta('RECIBO COPIADO', 'La imagen del recibo quedo lista para pegar en WhatsApp.');
    } catch {
        mostrarAlerta('COPIA NO DISPONIBLE', 'El navegador no permitio copiar la imagen. Puedes abrir el recibo y tomar captura.');
    }
}

function seleccionarTipoReporte(tipo) {
    const campo = document.getElementById('rep-tipo');
    if (campo) campo.value = tipo;
    document.getElementById('rep-btn-pago')?.classList.toggle('active', tipo === 'PAGO');
    document.getElementById('rep-btn-cobro')?.classList.toggle('active', tipo === 'COBRO');
    const valor = document.getElementById('rep-valor');
    if (valor) {
        valor.disabled = false;
        valor.placeholder = tipo === 'PAGO' ? 'Valor recibido' : 'Valor a cobrar';
        valor.focus();
    }
    actualizarResumenReporte();
}

function seleccionarAsociacionReporte(tipo) {
    document.getElementById('rep-asociacion').value = tipo;
    document.getElementById('rep-asoc-contrato')?.classList.toggle('active', tipo === 'contrato');
    document.getElementById('rep-asoc-factura')?.classList.toggle('active', tipo === 'factura');
    document.getElementById('rep-contrato-grupo').style.display = tipo === 'contrato' ? 'block' : 'none';
    document.getElementById('rep-factura-grupo').style.display = tipo === 'factura' ? 'block' : 'none';
    mostrarHistorialContratoSeleccionado();
    actualizarResumenReporte();
}

function renderContratosPorClienteSeleccionado() {
    const doc = clienteDocDesdeCampo(document.getElementById('rep-cliente')?.value || '');
    const contratos = doc ? dbContratos.filter(c => String(c.arrendatario1 || '').includes(doc) || String(c.arrendatario2 || '').includes(doc)) : [];
    const selectContrato = document.getElementById('rep-contrato');
    if (selectContrato) {
        const cortos = contratos.filter(c => String(c.tipoContrato || 'CORTO').toUpperCase() !== 'LARGO');
        selectContrato.innerHTML = '<option value="">Selecciona contrato corto</option>' + cortos.map(c => `<option value="${c.codigo}">${c.codigo} - ${c.estado || 'ACTIVO'} - ${c.moto || ''}</option>`).join('');
    }
    const selectFactura = document.getElementById('rep-factura');
    if (selectFactura) {
        const largas = contratos.filter(c => String(c.tipoContrato || 'CORTO').toUpperCase() === 'LARGO');
        const opciones = largas.flatMap(c => facturasContrato(c.codigo).map(f => `<option value="${f.id}">${f.numero} - ${c.codigo} - saldo ${Number(f.saldo || 0).toLocaleString('es-CO')}</option>`));
        selectFactura.innerHTML = '<option value="">Selecciona factura recurrente</option>' + opciones.join('');
    }
    mostrarHistorialContratoSeleccionado();
    actualizarResumenReporte();
}

function facturaReporteSeleccionada() {
    const id = document.getElementById('rep-factura')?.value || '';
    return dbFacturas.find(f => f.id === id);
}

function contratoReporteSeleccionado() {
    const asoc = document.getElementById('rep-asociacion')?.value || 'contrato';
    if (asoc === 'factura') {
        const factura = facturaReporteSeleccionada();
        return dbContratos.find(c => c.codigo === factura?.contratoCodigo);
    }
    const codigo = document.getElementById('rep-contrato')?.value || '';
    return dbContratos.find(c => c.codigo === codigo);
}

function actualizarResumenReporte() {
    const tipo = document.getElementById('rep-tipo')?.value || '';
    const cliente = document.getElementById('rep-cliente')?.value || 'Sin seleccionar';
    const contrato = contratoReporteSeleccionado();
    const factura = facturaReporteSeleccionada();
    const concepto = document.getElementById('rep-concepto')?.value || 'ALQUILER';
    const valor = parseMoneyInput(document.getElementById('rep-valor')?.value || '');
    const referencia = document.getElementById('rep-referencia')?.value || '-';
    const saldo = factura ? Number(factura.saldo || 0) : saldoContratoReporte(contrato);
    const contenedor = document.getElementById('rep-recibo-preview');
    if (!contenedor) return;
    contenedor.innerHTML = `<div class="pos-receipt">
        <div class="pos-receipt-head"><strong>RODEMOS</strong><span>${tipo || 'Selecciona Pago o Cobro'}</span></div>
        <div class="pos-receipt-body">
            <div class="pos-receipt-line"><span>Cliente</span><b>${cliente}</b></div>
            <div class="pos-receipt-line"><span>Contrato</span><b>${contrato?.codigo || '-'}</b></div>
            <div class="pos-receipt-line"><span>Factura</span><b>${factura?.numero || '-'}</b></div>
            <div class="pos-receipt-line"><span>Concepto</span><b>${concepto}</b></div>
            <div class="pos-receipt-line"><span>Referencia</span><b>${referencia}</b></div>
            <div class="pos-receipt-line total"><span>Valor</span><b>${valor ? valor.toLocaleString('es-CO') : '0'}</b></div>
            <div class="pos-receipt-line"><span>Saldo asociado</span><b>${Number(saldo || 0).toLocaleString('es-CO')}</b></div>
        </div>
    </div>`;
}

async function guardarReporteMovimiento() {
    const tipo = document.getElementById('rep-tipo')?.value || '';
    const asociacion = document.getElementById('rep-asociacion')?.value || 'contrato';
    const cliente = document.getElementById('rep-cliente')?.value.trim() || '';
    const contrato = contratoReporteSeleccionado();
    const factura = facturaReporteSeleccionada();
    const valor = parseMoneyInput(document.getElementById('rep-valor')?.value || '');
    if (!tipo) return mostrarAlerta('TIPO REQUERIDO', 'Selecciona si es pago o cobro.');
    if (!cliente) return mostrarAlerta('CLIENTE REQUERIDO', 'Asocia un cliente antes de guardar.');
    if (asociacion === 'contrato' && !contrato) return mostrarAlerta('CONTRATO REQUERIDO', 'Asocia un contrato corto.');
    if (asociacion === 'factura' && !factura) return mostrarAlerta('FACTURA REQUERIDA', 'Asocia una factura recurrente.');
    if (!valor) return mostrarAlerta('VALOR REQUERIDO', 'Ingresa el valor del movimiento.');
    if (asociacion === 'contrato' && String(contrato?.tipoContrato || 'CORTO').toUpperCase() === 'LARGO') {
        return mostrarAlerta('CONTRATO RECURRENTE', 'Los contratos largos se manejan desde factura recurrente.');
    }
    const soporteFile = document.getElementById('rep-soporte')?.files?.[0];
    const soporte = soporteFile ? await leerArchivoComoDocumento(soporteFile, `SOPORTE-${Date.now()}.${obtenerExtension(soporteFile)}`) : null;
    const movimiento = {
        id: `mov-${Date.now()}`,
        tipo,
        concepto: document.getElementById('rep-concepto')?.value || 'ALQUILER',
        cliente,
        contratoCodigo: contrato?.codigo || factura?.contratoCodigo || '',
        facturaId: factura?.id || '',
        referencia: document.getElementById('rep-referencia')?.value.trim() || '',
        valor,
        observacion: document.getElementById('rep-observacion')?.value.trim() || '',
        soporte,
        fecha: obtenerFechaHoraActual()
    };
    if (asociacion === 'factura' && factura) {
        factura.pagos = Array.isArray(factura.pagos) ? factura.pagos : [];
        const pago = {
            id: `fp-${Date.now()}`,
            reciboCodigo: generarCodigoReciboFactura(factura, factura.pagos.length + 1),
            fecha: obtenerFechaHoy(),
            registrado: obtenerFechaHoraActual(),
            valor: tipo === 'PAGO' ? valor : 0,
            recargo: tipo === 'COBRO' ? valor : 0,
            medio: movimiento.referencia || 'Reporte',
            referencia: movimiento.concepto,
            soporte
        };
        factura.pagos.push(pago);
        movimiento.reciboCodigo = pago.reciboCodigo;
        recalcularFacturasContrato(factura.contratoCodigo);
        persistirFacturas();
    }
    dbReportes.unshift(movimiento);
    persistirReportes();
    if (contrato) {
        contrato.historial = contrato.historial || [];
        contrato.historial.push({ fecha: obtenerFechaHoraActual(), detalle: `${movimiento.tipo} ${movimiento.concepto}: ${movimiento.referencia || 'Movimiento'} por ${movimiento.valor.toLocaleString('es-CO')}` });
        persistirContratos();
    }
    ['rep-referencia', 'rep-valor', 'rep-observacion'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const soporteInput = document.getElementById('rep-soporte');
    if (soporteInput) soporteInput.value = '';
    mostrarHistorialContratoSeleccionado();
    actualizarResumenReporte();
    renderClientesListado();
    mostrarAlerta('PROCESO COMPLETADO', 'Movimiento guardado correctamente.');
}

function mostrarHistorialContratoSeleccionado() {
    const contenedor = document.getElementById('historial-contrato');
    if (!contenedor) return;
    const factura = facturaReporteSeleccionada();
    const contrato = contratoReporteSeleccionado();
    if (factura) {
        const pagos = Array.isArray(factura.pagos) ? factura.pagos : [];
        contenedor.innerHTML = pagos.length ? pagos.map(p => `<div class="dashboard-item"><div><strong>${normalizarFechaParaMostrar(p.fecha)} | ${p.medio || '-'}</strong><small>Pago ${Number(p.valor || 0).toLocaleString('es-CO')} | Recargo ${Number(p.recargo || 0).toLocaleString('es-CO')}</small></div><button class="btn-icon" onclick="verReciboFactura('${factura.id}', '${p.id}')">Ver</button></div>`).join('') : '<div class="dashboard-empty">Sin pagos o recargos registrados en esta factura.</div>';
        return;
    }
    if (!contrato) return contenedor.innerHTML = '<div class="dashboard-empty">Selecciona un contrato o factura para ver su historial.</div>';
    const historial = contrato.historial || [];
    contenedor.innerHTML = historial.length ? historial.slice().reverse().map(item => `<div class="dashboard-item"><div><strong>${item.detalle}</strong><small>${item.fecha}</small></div></div>`).join('') : '<div class="dashboard-empty">Sin historial.</div>';
}

function inicializarReportes() {
    seleccionarAsociacionReporte('contrato');
    renderContratosPorClienteSeleccionado();
    mostrarHistorialContratoSeleccionado();
    actualizarResumenReporte();
}

let listadoClientesPaginaModal = 1;
const LISTADO_MODAL_POR_PAGINA = 15;

function clienteTieneContratoActivo(cliente) {
    const doc = String(cliente?.doc || '');
    if (!doc) return false;
    return obtenerContratosIniciales().some(c => {
        const estado = String(c.estado || 'ACTIVO').toUpperCase();
        const clienteEnContrato = String(c.arrendatario1 || '').includes(doc) || String(c.arrendatario2 || '').includes(doc);
        return clienteEnContrato && !['CERRADO', 'FINALIZADO', 'INACTIVO'].includes(estado);
    });
}

function estadoClienteCalculado(cliente) {
    return clienteTieneContratoActivo(cliente) ? 'ACTIVO' : 'INACTIVO';
}

function abrirListado(pagina = listadoClientesPaginaModal) {
    const tabla = document.getElementById('tabla-excel-body');
    if (!tabla) return;
    dbClientes.sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')));
    listadoClientesPaginaModal = Math.max(1, pagina);
    const totalPaginas = Math.max(1, Math.ceil(dbClientes.length / LISTADO_MODAL_POR_PAGINA));
    if (listadoClientesPaginaModal > totalPaginas) listadoClientesPaginaModal = totalPaginas;
    const inicio = (listadoClientesPaginaModal - 1) * LISTADO_MODAL_POR_PAGINA;
    const paginaClientes = dbClientes.slice(inicio, inicio + LISTADO_MODAL_POR_PAGINA);
    const thEliminar = document.getElementById('th-eliminar-clientes');
    if (thEliminar) thEliminar.style.display = modoEliminarClientes ? 'table-cell' : 'none';
    const btnConfirmar = document.getElementById('btn-confirmar-eliminar-clientes');
    const btnCancelar = document.getElementById('btn-cancelar-eliminar-clientes');
    if (btnConfirmar) btnConfirmar.style.display = modoEliminarClientes ? 'inline-flex' : 'none';
    if (btnCancelar) btnCancelar.style.display = modoEliminarClientes ? 'inline-flex' : 'none';
    tabla.innerHTML = paginaClientes.map((c, offset) => {
        const idx = inicio + offset;
        return `<tr>
            <td style="display:${modoEliminarClientes ? 'table-cell' : 'none'};"><input type="checkbox" ${clientesSeleccionadosEliminar.has(String(c.doc)) ? 'checked' : ''} onchange="toggleSeleccionEliminarCliente('${String(c.doc)}', this.checked)"></td>
            <td><b>${c.nombre || '-'}</b></td>
            <td>${c.doc || '-'}</td>
            <td>${c.tel || '-'}</td>
            <td>${c.barrio || '-'}</td>
            <td><button class="btn-listado" style="padding:2px 10px" onclick="cerrarModales(); verDetalle(${idx})">Ver</button></td>
        </tr>`;
    }).join('') || '<tr><td colspan="6" class="cliente-empty-row">No hay clientes registrados.</td></tr>';
    let paginador = document.getElementById('modal-listado-paginacion');
    if (!paginador) {
        paginador = document.createElement('div');
        paginador.id = 'modal-listado-paginacion';
        paginador.className = 'listado-paginacion-modal';
        tabla.closest('.excel-container')?.after(paginador);
    }
    paginador.innerHTML = `
        <button class="btn-listado" onclick="abrirListado(${listadoClientesPaginaModal - 1})" ${listadoClientesPaginaModal <= 1 ? 'disabled' : ''}>Anterior</button>
        <span>Pagina ${listadoClientesPaginaModal} de ${totalPaginas}</span>
        <button class="btn-listado" onclick="abrirListado(${listadoClientesPaginaModal + 1})" ${listadoClientesPaginaModal >= totalPaginas ? 'disabled' : ''}>Siguiente</button>
    `;
    document.getElementById('modal-listado')?.classList.add('show');
}

function cambiarPaginaClientesModal(delta) {
    abrirListado(listadoClientesPaginaModal + delta);
}

function renderClientesListado() {
    const tabla = document.getElementById('clientes-listado-body');
    if (!tabla) return;
    const resumen = document.getElementById('clientes-listado-resumen');
    const paginacion = document.getElementById('clientes-listado-paginacion');
    const clientes = obtenerClientesFiltrados();
    const totalPaginas = Math.max(1, Math.ceil(clientes.length / CLIENTES_POR_PAGINA));
    if (clientesPaginaActual > totalPaginas) clientesPaginaActual = totalPaginas;
    const inicio = (clientesPaginaActual - 1) * CLIENTES_POR_PAGINA;
    const pagina = clientes.slice(inicio, inicio + CLIENTES_POR_PAGINA);
    if (resumen) resumen.innerText = `${clientes.length} clientes encontrados. Mostrando ${clientes.length ? inicio + 1 : 0}-${inicio + pagina.length}.`;
    tabla.innerHTML = pagina.length ? pagina.map(({ cliente, idx }) => `<tr>
        <td><b>${cliente.nombre || '-'}</b></td>
        <td>${cliente.doc || '-'}</td>
        <td>${valorCliente(cliente, 'tel', 'telefono1') || '-'}</td>
        <td>${cliente.barrio || '-'}</td>
        <td>${cliente.ciudad || '-'}</td>
        <td>${estadoBadge(estadoClienteCalculado(cliente))}</td>
        <td>${formatoSaldo(saldoClienteSistema(cliente))}</td>
        <td>${cliente.email || '-'}</td>
        <td class="doc-actions">
            <button class="btn-listado" onclick="verDetalle(${idx})">Abrir ficha</button>
            <button class="btn-listado danger" onclick="eliminarClientePorIndice(${idx})">Eliminar</button>
        </td>
    </tr>`).join('') : `<tr><td colspan="9" class="cliente-empty-row">No hay clientes con esta busqueda. Puedes crear uno nuevo.</td></tr>`;
    if (paginacion) paginacion.innerHTML = `
        <button class="btn-listado" type="button" onclick="cambiarPaginaClientes(-1)" ${clientesPaginaActual <= 1 ? 'disabled' : ''}>Anterior</button>
        <span class="dashboard-page-label">Pagina ${clientesPaginaActual} de ${totalPaginas}</span>
        <button class="btn-listado" type="button" onclick="cambiarPaginaClientes(1)" ${clientesPaginaActual >= totalPaginas ? 'disabled' : ''}>Siguiente</button>
    `;
}

function verDetalle(idx) {
    clienteSeleccionadoIdx = idx;
    const c = dbClientes[idx];
    if (!c) return;
    document.getElementById('detalle-completo').style.display = 'flex';
    document.getElementById('cliente-modal-titulo').innerText = 'Ficha del cliente';
    ocultarBusqueda('area-coincidencias', 'btn-principal-crear');
    llenarCamposCliente(c);
    setLecturaCliente(true);
    cargarDocumentosCliente(c);
    setEstadoDocumentos(true);
    const btn = document.querySelector('#detalle-completo .btn-action');
    btn.innerText = 'MODIFICAR CLIENTE';
    btn.style.background = '#7a1c1c';
    btn.onclick = () => {
        setLecturaCliente(false);
        btn.innerText = 'GUARDAR CAMBIOS';
        btn.style.background = 'var(--primary-red)';
        btn.onclick = guardarExistente;
        setEstadoDocumentos(false);
    };
}

function normalizarTextoImportado(valor, mayuscula = true) {
    const texto = String(valor || '').trim();
    return mayuscula ? texto.toUpperCase() : texto;
}

function construirClienteDesdeFila(encabezados, fila) {
    const mapa = {};
    encabezados.forEach((encabezado, idx) => mapa[encabezado] = fila[idx] || '');
    return {
        nombre: normalizarTextoImportado(mapa.nombre || mapa.nombrecompleto || ''),
        doc: normalizarTextoImportado(mapa.documento || mapa.numeroid || mapa.cedula || mapa.cc || '', false),
        tipoId: normalizarTextoImportado(mapa.tipoid || mapa.tipodeid || 'CC'),
        email: normalizarTextoImportado(mapa.email || mapa.correoelectronico || mapa.correo || '', false),
        tel: normalizarTextoImportado(mapa.telefono || mapa.telefono1 || '', false),
        tel2: normalizarTextoImportado(mapa.telefono2 || '', false),
        dir: normalizarTextoImportado(mapa.direccion || ''),
        barrio: normalizarTextoImportado(mapa.barrio || ''),
        ciudad: normalizarTextoImportado(mapa.ciudad || ''),
        diasAlquiler: normalizarTextoImportado(mapa.numerodiasalquiler || mapa.numerodediasdealquiler || mapa.diasalquiler || '', false),
        estado: 'INACTIVO'
    };
}

async function importarClientes(input) {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async e => {
        try {
            const filas = parseCSV(String(e.target.result || ''));
            const encabezados = filas[0].map(normalizarEncabezadoImportacion);
            const exportarPendientes = [];
            const repetidos = [];
            for (let i = 1; i < filas.length; i++) {
                const fila = filas[i];
                if (!fila.some(col => String(col || '').trim())) continue;
                const registro = construirClienteDesdeFila(encabezados, fila);
                if (!registro.doc && !registro.nombre) continue;
                const nombreNorm = normalizarBusqueda(registro.nombre);
                const existente = dbClientes.find(item => {
                    const mismoDoc = registro.doc && String(item.doc || '') === String(registro.doc);
                    const mismoNombre = nombreNorm && normalizarBusqueda(item.nombre || '') === nombreNorm;
                    return mismoDoc || mismoNombre;
                });
                if (existente) {
                    repetidos.push(`${registro.nombre || '-'} / ${registro.doc || '-'}`);
                    continue;
                }
                dbClientes.push(registro);
                exportarPendientes.push(dbClientes.length - 1);
            }
            for (const idx of exportarPendientes) dbClientes[idx] = await exportarCarpetaCliente(dbClientes[idx], null);
            persistirClientes();
            clientesPaginaActual = 1;
            listadoClientesPaginaModal = 1;
            renderClientesListado();
            abrirListado(1);
            if (repetidos.length) mostrarAlerta('COINCIDENCIAS DETECTADAS', `${repetidos.length} cliente(s) ya existian por nombre o ID y no fueron cargados.`);
        } catch {
            mostrarAlerta('ERROR AL IMPORTAR', 'No fue posible leer el archivo CSV.');
        } finally {
            input.value = '';
        }
    };
    reader.readAsText(file, 'utf-8');
}

function aplicarIndicativoTelefono() {
    const campo = document.getElementById(telefonoIndicativoDestino);
    const valor = document.getElementById('telefono-indicativo-valor')?.value.trim() || '57';
    if (!campo) return cerrarModalIndicativo();
    const indicativo = `+${valor.replace(/^\+/, '').replace(/[^\d]/g, '') || '57'}`;
    const numero = String(campo.value || '').replace(/^\+\d+\s*/, '').replace(/[^\d\s-]/g, '').trim();
    campo.value = `${indicativo} ${numero}`.trim();
    cerrarModalIndicativo();
}

function barcodeHtml(codigo) {
    const chars = String(codigo || 'RODEMOS');
    return `<div class="receipt-barcode">${Array.from({ length: 54 }, (_, i) => {
        const code = chars.charCodeAt(i % chars.length) || 50;
        const h = 32 + ((code + i * 7) % 38);
        const w = ((code + i) % 4) + 2;
        return `<span style="height:${h}px;width:${w}px"></span>`;
    }).join('')}</div>`;
}

function marcarFacturaEmitida(id) {
    const factura = obtenerFactura(id);
    if (!factura) return;
    factura.emitida = true;
    factura.fechaEmitida = obtenerFechaHoraActual();
    persistirFacturas();
    renderFacturas();
}

function renderFacturas() {
    recalcularTodasFacturas();
    const contratos = contratosLargosActivos();
    const busqueda = normalizarBusqueda(document.getElementById('fact-busqueda')?.value || '');
    const tokens = busqueda.split(/\s+/).filter(Boolean);
    const estadoFiltro = document.getElementById('fact-filtro-estado')?.value || '';
    const filtrados = contratos.filter(c => {
        const texto = normalizarBusqueda(`${c.codigo || ''} ${c.arrendatario1 || ''} ${c.moto || ''}`);
        const okTexto = tokens.length ? tokens.every(t => texto.includes(t)) : true;
        const facturas = facturasContrato(c.codigo);
        const okEstado = estadoFiltro === 'EMITIDA'
            ? facturas.some(f => f.emitida)
            : estadoFiltro === 'PENDIENTE'
                ? facturas.some(f => !f.emitida && f.estado !== 'PAGADA')
                : true;
        return okTexto && okEstado;
    });
    const pendientes = dbFacturas.filter(f => !f.emitida && f.estado !== 'PAGADA');
    setTexto('fact-kpi-contratos', String(contratos.length));
    setTexto('fact-kpi-pendientes', String(pendientes.length));
    setTexto('fact-kpi-saldo', pendientes.reduce((t, f) => t + Math.max(0, Number(f.saldo || 0)), 0).toLocaleString('es-CO'));
    const body = document.getElementById('facturas-contratos-body');
    if (body) {
        body.innerHTML = filtrados.length ? filtrados.map(c => {
            const r = resumenFacturasContrato(c.codigo);
            return `<tr>
                <td><b>${c.arrendatario1 || '-'}</b></td>
                <td>${c.moto || '-'}</td>
                <td>${c.codigo || '-'}</td>
                <td>${Number(r.cobroFactura || 0).toLocaleString('es-CO')}</td>
                <td>${Number(r.saldoAnterior || 0).toLocaleString('es-CO')}</td>
                <td>${Number(r.pagado || 0).toLocaleString('es-CO')}</td>
                <td>${formatoSaldo(r.saldo)}</td>
                <td><button class="btn-listado" type="button" onclick="seleccionarContratoFacturas('${c.codigo}')">Revisar</button></td>
            </tr>`;
        }).join('') : '<tr><td colspan="8" class="cliente-empty-row">No hay facturas con estos filtros.</td></tr>';
    }
    if (facturasContratoActual) renderDetalleFacturas();
}

function renderDetalleFacturas() {
    const body = document.getElementById('facturas-lista-body');
    if (!body) return;
    const contrato = dbContratos.find(c => c.codigo === facturasContratoActual);
    if (!contrato) {
        body.innerHTML = '<tr><td colspan="10" class="cliente-empty-row">Selecciona un contrato recurrente.</td></tr>';
        return;
    }
    recalcularFacturasContrato(contrato.codigo);
    setTexto('fact-detalle-titulo', `Historial ${contrato.codigo}`);
    setTexto('fact-detalle-subtitulo', `${contrato.arrendatario1 || '-'} | ${contrato.moto || '-'} | saldo ${balanceContratoFactura(contrato.codigo).toLocaleString('es-CO')}`);
    const facturas = facturasContrato(contrato.codigo);
    body.innerHTML = facturas.length ? facturas.map(f => `<tr>
        <td><b>${f.numero}</b><br><small>${f.emitida ? `Emitida ${f.fechaEmitida || ''}` : 'Pendiente de emitir'}</small></td>
        <td>${normalizarFechaParaMostrar(f.desde)}</td>
        <td>${normalizarFechaParaMostrar(f.hasta)}</td>
        <td>${f.moto || contrato.moto || '-'}</td>
        <td>${Number(f.valor || 0).toLocaleString('es-CO')}</td>
        <td>${Number(f.saldoAnterior || 0).toLocaleString('es-CO')}</td>
        <td>${Number(f.pagado || 0).toLocaleString('es-CO')}</td>
        <td>${formatoSaldo(f.saldo)}</td>
        <td>${f.emitida ? '<span class="status-pill active">Emitida</span>' : '<span class="status-pill warn">Pendiente</span>'}</td>
        <td class="doc-actions">
            <button class="btn-listado" type="button" onclick="abrirPagoFactura('${f.id}')">Reportar pago</button>
            <button class="btn-listado" type="button" onclick="abrirPagoFactura('${f.id}')">Generar cobro</button>
            <button class="btn-listado" type="button" onclick="verReciboFactura('${f.id}')">Ver</button>
            ${f.emitida ? '' : `<button class="btn-listado" type="button" onclick="marcarFacturaEmitida('${f.id}')">Emitida</button>`}
        </td>
    </tr>`).join('') : '<tr><td colspan="10" class="cliente-empty-row">Todavia no hay facturas. Genera la primera factura de este contrato.</td></tr>';
}

function construirHtmlReciboFactura(factura, movimientoId = '') {
    recalcularFacturasContrato(factura.contratoCodigo);
    const movimientos = factura.pagos || [];
    const movimiento = movimientos.find(p => p.id === movimientoId) || movimientos[movimientos.length - 1] || null;
    const codigo = movimiento?.reciboCodigo || generarCodigoReciboFactura(factura, movimientos.length || 1);
    return `<div class="pos-receipt">
        <div class="pos-receipt-head"><strong>RODEMOS</strong><span>Recibo POS</span><div class="receipt-code-row">${codigo}</div></div>
        <div class="pos-receipt-body">
            <div class="pos-receipt-line"><span>Cliente</span><b>${factura.cliente || '-'}</b></div>
            <div class="pos-receipt-line"><span>Contrato</span><b>${factura.contratoCodigo}</b></div>
            <div class="pos-receipt-line"><span>Factura</span><b>${factura.numero}</b></div>
            <div class="pos-receipt-line"><span>Moto</span><b>${factura.moto || '-'}</b></div>
            <div class="pos-receipt-line"><span>Periodo</span><b>${normalizarFechaParaMostrar(factura.desde)} / ${normalizarFechaParaMostrar(factura.hasta)}</b></div>
            <div class="pos-receipt-line"><span>Fecha pago</span><b>${normalizarFechaParaMostrar(movimiento?.fecha || obtenerFechaHoy())}</b></div>
            <div class="pos-receipt-line"><span>Hora creado</span><b>${movimiento?.registrado || obtenerFechaHoraActual()}</b></div>
            <div class="pos-receipt-line"><span>Medio</span><b>${movimiento?.medio || '-'}</b></div>
            <div class="pos-receipt-line"><span>Referencia</span><b>${movimiento?.referencia || '-'}</b></div>
            <div class="pos-receipt-line"><span>Pago</span><b>${Number(movimiento?.valor || 0).toLocaleString('es-CO')}</b></div>
            <div class="pos-receipt-line"><span>Recargo</span><b>${Number(movimiento?.recargo || 0).toLocaleString('es-CO')}</b></div>
            <div class="pos-receipt-line total"><span>Saldo factura</span><b>${Number(factura.saldo || 0).toLocaleString('es-CO')}</b></div>
            ${barcodeHtml(codigo)}
        </div>
    </div>`;
}

function dibujarReciboReporteCanvas(movimiento) {
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 1180;
    canvas.className = 'receipt-canvas-preview';
    const ctx = canvas.getContext('2d');
    const codigo = movimiento.reciboCodigo || movimiento.id || `RP-${Date.now()}`;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#3a0d12';
    ctx.fillRect(0, 0, canvas.width, 190);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = 'bold 48px Arial';
    ctx.fillText('RODEMOS', 450, 74);
    ctx.font = '24px Arial';
    ctx.fillText('RECIBO POS', 450, 116);
    ctx.fillText(codigo, 450, 154);
    const contrato = dbContratos.find(c => c.codigo === movimiento.contratoCodigo);
    const factura = dbFacturas.find(f => f.id === movimiento.facturaId);
    const filas = [
        ['Tipo', movimiento.tipo || '-'],
        ['Cliente', movimiento.cliente || '-'],
        ['Contrato', movimiento.contratoCodigo || '-'],
        ['Factura', factura?.numero || '-'],
        ['Moto', contrato?.moto || factura?.moto || '-'],
        ['Concepto', movimiento.concepto || '-'],
        ['Referencia', movimiento.referencia || '-'],
        ['Fecha y hora', movimiento.fecha || obtenerFechaHoraActual()],
        ['Observacion', movimiento.observacion || '-'],
        ['Valor', Number(movimiento.valor || 0).toLocaleString('es-CO')]
    ];
    ctx.textAlign = 'left';
    let y = 250;
    filas.forEach(([label, value], idx) => {
        ctx.fillStyle = idx === filas.length - 1 ? '#d32f2f' : '#6b7280';
        ctx.font = idx === filas.length - 1 ? 'bold 31px Arial' : '24px Arial';
        ctx.fillText(label, 70, y);
        ctx.fillStyle = idx === filas.length - 1 ? '#d32f2f' : '#111827';
        ctx.font = idx === filas.length - 1 ? 'bold 34px Arial' : 'bold 24px Arial';
        const texto = String(value);
        ctx.fillText(texto.length > 36 ? `${texto.slice(0, 36)}...` : texto, 330, y);
        ctx.strokeStyle = '#e5e7eb';
        ctx.beginPath();
        ctx.moveTo(70, y + 24);
        ctx.lineTo(830, y + 24);
        ctx.stroke();
        y += 70;
    });
    let seed = 0;
    for (let i = 0; i < codigo.length; i++) seed += codigo.charCodeAt(i) * (i + 1);
    let x = 158;
    for (let i = 0; i < 90; i++) {
        const w = ((seed + i * 5) % 4) + 2;
        const h = 70 + ((seed + i * 9) % 44);
        ctx.fillStyle = '#111827';
        ctx.fillRect(x, 940, w, h);
        x += w + 3;
    }
    ctx.fillStyle = '#6b7280';
    ctx.font = '20px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Comprobante generado por Rodemos Invergroup', 450, 1140);
    return canvas;
}

function verReciboReporte(id) {
    const mov = dbReportes.find(m => m.id === id);
    const contenedor = document.getElementById('recibo-reporte-preview');
    if (!mov || !contenedor) return;
    if (!mov.reciboCodigo) {
        mov.reciboCodigo = `RP-${Date.now().toString().slice(-7)}-${String(dbReportes.indexOf(mov) + 1).padStart(3, '0')}`;
        persistirReportes();
    }
    contenedor.innerHTML = '';
    contenedor.appendChild(dibujarReciboReporteCanvas(mov));
    document.getElementById('modal-recibo-reporte')?.classList.add('show');
}

function cerrarReciboReporte() {
    document.getElementById('modal-recibo-reporte')?.classList.remove('show');
}

async function copiarReciboReporte() {
    const canvas = document.querySelector('#recibo-reporte-preview canvas');
    if (!canvas) return;
    try {
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        mostrarAlerta('RECIBO COPIADO', 'La imagen del recibo quedo lista para pegar.');
    } catch {
        mostrarAlerta('COPIA NO DISPONIBLE', 'El navegador no permitio copiar la imagen. Puedes tomar captura del recibo.');
    }
}

function renderHistorialReportes() {
    const body = document.getElementById('historial-reportes-body');
    if (!body) return;
    const movimientos = movimientosReporteFiltrados();
    body.innerHTML = movimientos.length ? movimientos.map(mov => {
        const contrato = dbContratos.find(c => c.codigo === mov.contratoCodigo);
        return `<tr>
            <td>${mov.fecha || '-'}</td>
            <td>${mov.tipo || '-'}</td>
            <td>${mov.cliente || '-'}</td>
            <td>${mov.contratoCodigo || '-'}</td>
            <td>${contrato?.moto || '-'}</td>
            <td>${mov.concepto || '-'}</td>
            <td>${mov.referencia || mov.observacion || '-'}</td>
            <td>${Number(mov.valor || 0).toLocaleString('es-CO')}</td>
            <td>${mov.soporte?.dataUrl ? `<button class="btn-listado" onclick="abrirArchivo(${JSON.stringify(mov.soporte).replace(/"/g, '&quot;')})">Ver</button>` : '-'}</td>
            <td><button class="btn-listado" onclick="verReciboReporte('${mov.id}')">Ver recibo</button></td>
        </tr>`;
    }).join('') : '<tr><td colspan="10" class="cliente-empty-row">No hay movimientos con estos filtros.</td></tr>';
}

function seleccionarAsociacionReporte(tipo) {
    document.getElementById('rep-asociacion').value = tipo;
    document.getElementById('rep-asoc-contrato')?.classList.toggle('active', tipo === 'contrato');
    document.getElementById('rep-asoc-factura')?.classList.toggle('active', tipo === 'factura');
    document.getElementById('rep-contrato-grupo').style.display = tipo === 'contrato' ? 'block' : 'none';
    document.getElementById('rep-factura-grupo').style.display = tipo === 'factura' ? 'block' : 'none';
    actualizarResumenReporte();
}

function renderContratosPorClienteSeleccionado() {
    const doc = clienteDocDesdeCampo(document.getElementById('rep-cliente')?.value || '');
    const contratos = doc ? dbContratos.filter(c => String(c.arrendatario1 || '').includes(doc) || String(c.arrendatario2 || '').includes(doc)) : [];
    const selectContrato = document.getElementById('rep-contrato');
    if (selectContrato) {
        selectContrato.innerHTML = '<option value="">Selecciona contrato</option>' + contratos.map(c => `<option value="${c.codigo}">${c.codigo} - ${c.estado || 'ACTIVO'} - ${c.moto || ''}</option>`).join('');
    }
    const selectFactura = document.getElementById('rep-factura');
    if (selectFactura) {
        const opciones = contratos.flatMap(c => facturasContrato(c.codigo).map(f => `<option value="${f.id}">${f.numero} - ${c.codigo} - saldo ${Number(f.saldo || 0).toLocaleString('es-CO')}</option>`));
        selectFactura.innerHTML = '<option value="">Selecciona factura</option>' + opciones.join('');
    }
    actualizarResumenReporte();
}

async function guardarReporteMovimiento() {
    const tipo = document.getElementById('rep-tipo')?.value || '';
    const asociacion = document.getElementById('rep-asociacion')?.value || 'contrato';
    const cliente = document.getElementById('rep-cliente')?.value.trim() || '';
    const contrato = contratoReporteSeleccionado();
    const factura = facturaReporteSeleccionada();
    const valor = parseMoneyInput(document.getElementById('rep-valor')?.value || '');
    if (!tipo) return mostrarAlerta('TIPO REQUERIDO', 'Selecciona si es pago o cobro.');
    if (!cliente) return mostrarAlerta('CLIENTE REQUERIDO', 'Asocia un cliente antes de guardar.');
    if (asociacion === 'contrato' && !contrato) return mostrarAlerta('CONTRATO REQUERIDO', 'Asocia un contrato.');
    if (asociacion === 'factura' && !factura) return mostrarAlerta('FACTURA REQUERIDA', 'Asocia una factura.');
    if (!valor) return mostrarAlerta('VALOR REQUERIDO', 'Ingresa el valor del movimiento.');
    const soporteFile = document.getElementById('rep-soporte')?.files?.[0];
    const soporte = soporteFile ? await leerArchivoComoDocumento(soporteFile, `SOPORTE-${Date.now()}.${obtenerExtension(soporteFile)}`) : null;
    const reciboCodigo = `RP-${Date.now().toString().slice(-8)}-${String(dbReportes.length + 1).padStart(4, '0')}`;
    const movimiento = {
        id: `mov-${Date.now()}`,
        reciboCodigo,
        tipo,
        concepto: document.getElementById('rep-concepto')?.value || 'ALQUILER',
        cliente,
        contratoCodigo: contrato?.codigo || factura?.contratoCodigo || '',
        facturaId: factura?.id || '',
        referencia: document.getElementById('rep-referencia')?.value.trim() || '',
        valor,
        observacion: document.getElementById('rep-observacion')?.value.trim() || '',
        soporte,
        fecha: obtenerFechaHoraActual()
    };
    dbReportes.unshift(movimiento);
    persistirReportes();
    ['rep-referencia', 'rep-valor', 'rep-observacion'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const soporteInput = document.getElementById('rep-soporte');
    if (soporteInput) soporteInput.value = '';
    actualizarResumenReporte();
    renderClientesListado();
    verReciboReporte(movimiento.id);
}

function actualizarResumenReporte() {
    const tipo = document.getElementById('rep-tipo')?.value || '';
    const cliente = document.getElementById('rep-cliente')?.value || 'Sin seleccionar';
    const contrato = contratoReporteSeleccionado();
    const factura = facturaReporteSeleccionada();
    const concepto = document.getElementById('rep-concepto')?.value || 'ALQUILER';
    const valor = parseMoneyInput(document.getElementById('rep-valor')?.value || '');
    const referencia = document.getElementById('rep-referencia')?.value || '-';
    const codigo = 'PREVISUALIZACION';
    const contenedor = document.getElementById('rep-recibo-preview');
    if (!contenedor) return;
    contenedor.innerHTML = `<div class="pos-receipt">
        <div class="pos-receipt-head"><strong>RODEMOS</strong><span>${tipo || 'Selecciona Pago o Cobro'}</span><div class="receipt-code-row">${codigo}</div></div>
        <div class="pos-receipt-body">
            <div class="pos-receipt-line"><span>Cliente</span><b>${cliente}</b></div>
            <div class="pos-receipt-line"><span>Contrato</span><b>${contrato?.codigo || '-'}</b></div>
            <div class="pos-receipt-line"><span>Factura</span><b>${factura?.numero || '-'}</b></div>
            <div class="pos-receipt-line"><span>Fecha y hora</span><b>${obtenerFechaHoraActual()}</b></div>
            <div class="pos-receipt-line"><span>Concepto</span><b>${concepto}</b></div>
            <div class="pos-receipt-line"><span>Referencia</span><b>${referencia}</b></div>
            <div class="pos-receipt-line total"><span>Valor</span><b>${valor ? valor.toLocaleString('es-CO') : '0'}</b></div>
            ${barcodeHtml(codigo)}
        </div>
    </div>`;
}

async function responderSolicitud(event, autor) {
    event.preventDefault();
    const input = document.getElementById(autor === 'admin' ? 'config-respuesta-texto' : 'respuesta-asesora') || document.getElementById(autor === 'admin' ? 'respuesta-admin' : 'respuesta-asesora');
    const texto = input?.value.trim() || '';
    const imagenInput = document.getElementById(autor === 'admin' ? 'respuesta-admin-imagen' : 'respuesta-asesora-imagen');
    const solicitud = dashboardData.solicitudes.find(item => item.id === solicitudSeleccionadaId);
    if (!texto || !solicitud) return;
    let imagen = null;
    const file = imagenInput?.files?.[0];
    if (file) imagen = await leerArchivoComoDocumento(file, `CHAT-${Date.now()}.${obtenerExtension(file)}`);
    solicitud.mensajes.push({ autor, texto, fecha: obtenerFechaHoraActual(), imagen });
    solicitud.ultimaActividad = obtenerFechaHoraActual();
    if (autor === 'admin') {
        solicitud.unreadAsesora = Number(solicitud.unreadAsesora || 0) + 1;
        solicitud.unreadAdmin = 0;
        emitirSonidoMensaje();
    } else {
        solicitud.unreadAdmin = Number(solicitud.unreadAdmin || 0) + 1;
        solicitud.unreadAsesora = 0;
    }
    if (solicitud.estado === 'cerrada') {
        solicitud.estado = 'abierta';
        solicitud.carpeta = 'principal';
        solicitud.abiertoPor = autor;
    }
    persistirDashboard();
    input.value = '';
    if (imagenInput) imagenInput.value = '';
    renderSolicitudes(false);
    renderSolicitudes(true);
    renderResumenDashboard();
}

function dibujarReciboCanvas(factura, movimientoId = '') {
    recalcularFacturasContrato(factura.contratoCodigo);
    const movimientos = factura.pagos || [];
    const movimiento = movimientos.find(p => p.id === movimientoId) || movimientos[movimientos.length - 1] || {};
    const codigo = movimiento.reciboCodigo || generarCodigoReciboFactura(factura, movimientos.length || 1);
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 1180;
    canvas.className = 'receipt-canvas-preview';
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#3a0d12';
    ctx.fillRect(0, 0, canvas.width, 190);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 48px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('RODEMOS', 450, 76);
    ctx.font = '24px Arial';
    ctx.fillText('RECIBO POS', 450, 118);
    ctx.fillText(codigo, 450, 154);
    const filas = [
        ['Cliente', factura.cliente || '-'],
        ['Contrato', factura.contratoCodigo || '-'],
        ['Factura', factura.numero || '-'],
        ['Moto', factura.moto || '-'],
        ['Periodo', `${normalizarFechaParaMostrar(factura.desde)} / ${normalizarFechaParaMostrar(factura.hasta)}`],
        ['Fecha pago', normalizarFechaParaMostrar(movimiento.fecha || obtenerFechaHoy())],
        ['Hora creado', movimiento.registrado || obtenerFechaHoraActual()],
        ['Medio', movimiento.medio || '-'],
        ['Referencia', movimiento.referencia || '-'],
        ['Pago', Number(movimiento.valor || 0).toLocaleString('es-CO')],
        ['Recargo', Number(movimiento.recargo || 0).toLocaleString('es-CO')],
        ['Saldo factura', Number(factura.saldo || 0).toLocaleString('es-CO')]
    ];
    ctx.textAlign = 'left';
    let y = 240;
    filas.forEach(([label, value], idx) => {
        ctx.fillStyle = idx === filas.length - 1 ? '#d32f2f' : '#6b7280';
        ctx.font = idx === filas.length - 1 ? 'bold 29px Arial' : '23px Arial';
        ctx.fillText(label, 70, y);
        ctx.fillStyle = idx === filas.length - 1 ? '#d32f2f' : '#111827';
        ctx.font = idx === filas.length - 1 ? 'bold 31px Arial' : 'bold 23px Arial';
        const texto = String(value);
        ctx.fillText(texto.length > 34 ? `${texto.slice(0, 34)}...` : texto, 330, y);
        ctx.strokeStyle = '#e5e7eb';
        ctx.beginPath();
        ctx.moveTo(70, y + 23);
        ctx.lineTo(830, y + 23);
        ctx.stroke();
        y += 58;
    });
    let seed = 0;
    for (let i = 0; i < codigo.length; i++) seed += codigo.charCodeAt(i) * (i + 1);
    let x = 160;
    for (let i = 0; i < 92; i++) {
        const w = ((seed + i * 5) % 4) + 2;
        const h = 70 + ((seed + i * 9) % 42);
        ctx.fillStyle = '#111827';
        ctx.fillRect(x, 960, w, h);
        x += w + 3;
    }
    ctx.fillStyle = '#6b7280';
    ctx.font = '20px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(codigo, 450, 1096);
    ctx.fillText('Comprobante generado por Rodemos Invergroup', 450, 1140);
    return canvas;
}

function llenarCamposCliente(cliente = {}) {
    const mapa = {
        'form-nombre': cliente.nombre || '',
        'form-doc': cliente.doc || '',
        'tipo-id': cliente.tipoId || cliente.tipoID || 'CC',
        email: cliente.email || '',
        tel: cliente.tel || cliente.telefono1 || '',
        tel2: cliente.tel2 || cliente.telefono2 || '',
        dir: cliente.dir || cliente.direccion || '',
        barrio: cliente.barrio || '',
        ciudad: cliente.ciudad || '',
        'dias-alquiler': cliente.diasAlquiler || '',
        estado: cliente.estado || 'INACTIVO'
    };
    Object.keys(mapa).forEach(key => {
        const el = document.getElementById(`cli-${key}`);
        if (el) el.value = mapa[key];
    });
}

function cerrarFormularioCliente() {
    ocultarDetalleCliente();
    setEstadoDocumentos(true);
    const nombre = document.getElementById('cli-nombre');
    const doc = document.getElementById('cli-doc');
    if (nombre) nombre.value = '';
    if (doc) doc.value = '';
    ocultarBusqueda('area-coincidencias', 'btn-principal-crear');
    clientesPaginaActual = 1;
    renderClientesListado();
}

function construirClienteDesdeFormulario(base) {
    return {
        ...base,
        nombre: (document.getElementById('cli-form-nombre')?.value || '').toUpperCase().trim(),
        doc: (document.getElementById('cli-form-doc')?.value || '').trim(),
        tipoId: document.getElementById('cli-tipo-id')?.value || 'CC',
        email: document.getElementById('cli-email')?.value.trim() || '',
        tel: document.getElementById('cli-tel')?.value.trim() || '',
        tel2: document.getElementById('cli-tel2')?.value.trim() || '',
        dir: document.getElementById('cli-dir')?.value.toUpperCase().trim() || '',
        barrio: document.getElementById('cli-barrio')?.value.toUpperCase().trim() || '',
        ciudad: document.getElementById('cli-ciudad')?.value.toUpperCase().trim() || '',
        diasAlquiler: document.getElementById('cli-dias-alquiler')?.value.trim() || '',
        estado: document.getElementById('cli-estado')?.value || 'INACTIVO',
        ...fotosTemp,
        otrosDocs: otrosDocsTemp.map(doc => ({ id: doc.id, titulo: doc.titulo, archivo: doc.archivo }))
    };
}

function abrirModalIndicativo(inputId) {
    telefonoIndicativoDestino = inputId;
    const input = document.getElementById('telefono-indicativo-valor');
    if (input) input.value = '';
    document.getElementById('modal-indicativo-telefono')?.classList.add('show');
    setTimeout(() => input?.focus(), 50);
}

function seleccionarAsociacionReporte() {
    const campo = document.getElementById('rep-asociacion');
    if (campo) campo.value = 'contrato';
    const contratoGrupo = document.getElementById('rep-contrato-grupo');
    const facturaGrupo = document.getElementById('rep-factura-grupo');
    if (contratoGrupo) contratoGrupo.style.display = 'block';
    if (facturaGrupo) facturaGrupo.style.display = 'none';
    actualizarResumenReporte();
}

function facturaReporteSeleccionada() {
    return null;
}

function eliminarFacturaContratoCompleto(codigo) {
    pedirClaveAdminModal(`Eliminar todas las facturas del contrato ${codigo}.`, () => {
        dbFacturas = dbFacturas.filter(f => f.contratoCodigo !== codigo);
        persistirFacturas();
        if (facturasContratoActual === codigo) cerrarDetalleFacturas();
        renderFacturas();
        mostrarAlerta('FACTURAS ELIMINADAS', 'Se elimino el historial de facturas de este contrato.');
    });
}

function eliminarFacturaPorId(id) {
    const factura = obtenerFactura(id);
    if (!factura) return;
    pedirClaveAdminModal(`Eliminar la factura ${factura.numero}.`, () => {
        dbFacturas = dbFacturas.filter(f => f.id !== id);
        recalcularFacturasContrato(factura.contratoCodigo);
        persistirFacturas();
        renderFacturas();
        mostrarAlerta('FACTURA ELIMINADA', 'La factura fue eliminada correctamente.');
    });
}

function renderFacturas() {
    recalcularTodasFacturas();
    const contratos = contratosLargosActivos();
    const busqueda = normalizarBusqueda(document.getElementById('fact-busqueda')?.value || '');
    const tokens = busqueda.split(/\s+/).filter(Boolean);
    const estadoFiltro = document.getElementById('fact-filtro-estado')?.value || 'PENDIENTE';
    const filtrados = contratos.filter(c => {
        const texto = normalizarBusqueda(`${c.codigo || ''} ${c.arrendatario1 || ''} ${c.moto || ''}`);
        const okTexto = tokens.length ? tokens.every(t => texto.includes(t)) : true;
        const facturas = facturasContrato(c.codigo);
        const okEstado = estadoFiltro === 'EMITIDA'
            ? facturas.some(f => f.emitida)
            : estadoFiltro === 'PENDIENTE'
                ? facturas.some(f => !f.emitida)
                : true;
        return okTexto && okEstado;
    });
    const pendientes = dbFacturas.filter(f => !f.emitida);
    setTexto('fact-kpi-contratos', String(contratos.length));
    setTexto('fact-kpi-pendientes', String(pendientes.length));
    setTexto('fact-kpi-saldo', pendientes.reduce((t, f) => t + Math.max(0, Number(f.saldo || 0)), 0).toLocaleString('es-CO'));
    const body = document.getElementById('facturas-contratos-body');
    if (body) {
        body.innerHTML = filtrados.length ? filtrados.map(c => {
            const facturas = facturasContrato(c.codigo);
            const r = resumenFacturasContrato(c.codigo);
            const total = facturas.reduce((sum, f) => sum + Number(f.total || 0), 0);
            return `<tr>
                <td><b>${c.arrendatario1 || '-'}</b></td>
                <td>${c.moto || '-'}</td>
                <td>${c.codigo || '-'}</td>
                <td>${Number(total || r.cobroFactura || 0).toLocaleString('es-CO')}</td>
                <td>${Number(r.pagado || 0).toLocaleString('es-CO')}</td>
                <td>${formatoSaldo(r.saldo)}</td>
                <td class="doc-actions">
                    <button class="btn-listado" type="button" onclick="seleccionarContratoFacturas('${c.codigo}')">Revisar</button>
                    <button class="btn-listado danger" type="button" onclick="eliminarFacturaContratoCompleto('${c.codigo}')">Eliminar</button>
                </td>
            </tr>`;
        }).join('') : '<tr><td colspan="7" class="cliente-empty-row">No hay facturas con estos filtros.</td></tr>';
    }
    if (facturasContratoActual) renderDetalleFacturas();
}

function renderDetalleFacturas() {
    const body = document.getElementById('facturas-lista-body');
    if (!body) return;
    const contrato = dbContratos.find(c => c.codigo === facturasContratoActual);
    if (!contrato) {
        body.innerHTML = '<tr><td colspan="10" class="cliente-empty-row">Selecciona un contrato recurrente.</td></tr>';
        return;
    }
    recalcularFacturasContrato(contrato.codigo);
    setTexto('fact-detalle-titulo', `Historial ${contrato.codigo}`);
    setTexto('fact-detalle-subtitulo', `${contrato.arrendatario1 || '-'} | ${contrato.moto || '-'} | saldo ${balanceContratoFactura(contrato.codigo).toLocaleString('es-CO')}`);
    const facturas = facturasContrato(contrato.codigo);
    body.innerHTML = facturas.length ? facturas.map(f => `<tr>
        <td><b>${f.numero}</b><br><small>${f.emitida ? `Emitida ${f.fechaEmitida || ''}` : 'Pendiente de emitir'}</small></td>
        <td>${normalizarFechaParaMostrar(f.desde)}</td>
        <td>${normalizarFechaParaMostrar(f.hasta)}</td>
        <td>${f.moto || contrato.moto || '-'}</td>
        <td>${Number(f.valor || 0).toLocaleString('es-CO')}</td>
        <td>${Number(f.saldoAnterior || 0).toLocaleString('es-CO')}</td>
        <td>${Number(f.pagado || 0).toLocaleString('es-CO')}</td>
        <td>${formatoSaldo(f.saldo)}</td>
        <td>${f.emitida ? '<span class="status-pill active">Emitida</span>' : '<span class="status-pill warn">Pendiente</span>'}</td>
        <td class="doc-actions">
            <button class="btn-listado" type="button" onclick="abrirPagoFactura('${f.id}')">Reportar pago</button>
            <button class="btn-listado" type="button" onclick="verReciboFactura('${f.id}')">Ver</button>
            ${f.emitida ? '' : `<button class="btn-listado" type="button" onclick="marcarFacturaEmitida('${f.id}')">Emitida</button>`}
            <button class="btn-listado danger" type="button" onclick="eliminarFacturaPorId('${f.id}')">Eliminar</button>
        </td>
    </tr>`).join('') : '<tr><td colspan="10" class="cliente-empty-row">Todavia no hay facturas. Genera la primera factura de este contrato.</td></tr>';
}

function contratoValorCampo(valor) {
    return valor === undefined || valor === null || valor === '' ? '0' : String(valor);
}

function buscarClienteContrato(texto) {
    const doc = clienteDocDesdeCampo(texto || '');
    return dbClientes.find(c => String(c.doc || '') === String(doc)) || {};
}

function buscarMotoContrato(texto) {
    const placa = motoPlacaDesdeTexto(texto || '');
    return dbMotos.find(m => String(m.placa || '').toUpperCase() === placa) || {};
}

function campoContrato(label, valor, extra = '') {
    return `<div class="contract-print-field ${extra}"><span>${label}</span><b>${valor || '0'}</b></div>`;
}

function construirHtmlImpresionContrato(contrato) {
    const data = construirResumenContrato(contrato);
    const arr1 = buscarClienteContrato(contrato.arrendatario1);
    const arr2 = buscarClienteContrato(contrato.arrendatario2);
    const moto = buscarMotoContrato(contrato.moto);
    const totalAlquiler = Number(data.alquiler?.total || contrato.valor || 0);
    const pagadoAlquiler = Number(data.alquiler?.pagado || 0);
    const saldoAlquiler = Number(data.alquiler?.saldo || totalAlquiler);
    const depositoTotal = Number(data.deposito?.total || 0);
    const depositoPagado = Number(data.deposito?.pagado || 0);
    return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>${data.codigo}</title>
<style>
@page { size: letter portrait; margin: 8mm; }
* { box-sizing: border-box; }
body { font-family: Arial, sans-serif; color:#111; margin:0; background:#fff; }
.contract-page { width:100%; min-height: 100vh; padding: 6px 8px; page-break-after: always; position:relative; }
.contract-title { display:flex; justify-content:flex-end; align-items:center; gap:14px; margin-bottom:8px; }
.contract-title small { font-weight:900; font-size:9px; }
.contract-code { background:#e5e7eb; font-size:30px; font-weight:900; padding:8px 28px; }
.section-title { color:#d00000; font-size:10px; font-weight:900; border-bottom:1px solid #d00000; padding-bottom:2px; margin:7px 0 6px; text-transform:uppercase; }
.grid-4 { display:grid; grid-template-columns: 2.1fr .9fr 1.15fr .95fr; gap:6px 12px; }
.grid-5 { display:grid; grid-template-columns: .9fr 1fr 1fr 1fr 1fr; gap:6px 12px; }
.grid-6 { display:grid; grid-template-columns: repeat(6, 1fr); gap:6px 12px; }
.contract-print-field span { display:block; font-size:8px; font-weight:900; text-transform:uppercase; margin-bottom:2px; }
.contract-print-field b { display:block; min-height:18px; background:#d9d9d9; padding:4px 6px; font-size:10px; text-align:right; color:#6b7280; }
.contract-print-field.big b { min-height:32px; font-size:18px; color:#111; text-align:center; padding-top:9px; }
.contract-print-field.warn b { background:#ffcbd1; color:#d00000; font-weight:900; }
.money-box { border:1px solid #d00000; padding:6px; }
.watermark { position:absolute; inset:0; display:grid; place-items:center; font-size:96px; color:rgba(0,0,0,.16); font-weight:400; pointer-events:none; }
.terms { font-size:8.2px; line-height:1.35; margin-top:10px; max-width:56%; }
.signatures { position:absolute; right:8px; bottom:32px; width:42%; display:grid; gap:34px; }
.sig-row { display:grid; grid-template-columns: 1fr 74px; gap:12px; align-items:end; }
.sig-line { border-top:1px solid #111; padding-top:4px; font-size:9px; font-weight:900; }
.finger { width:74px; height:116px; border:1px solid #111; border-radius:14px; }
.page-2 { font-size:11px; line-height:1.45; }
.page-2 h2 { color:#d00000; border-bottom:1px solid #d00000; font-size:15px; }
@media print { .contract-page { page-break-after: always; } }
</style></head><body>
<section class="contract-page">
  <div class="watermark">Padilla</div>
  <div class="contract-title"><small># CONTRATO</small><div class="contract-code">${data.codigo}</div></div>
  <div class="section-title">Informacion arrendatario 1</div>
  <div class="grid-4">
    ${campoContrato('Nombres', arr1.nombre || data.arr1)}
    ${campoContrato('Tipo ID', arr1.tipoId || 'CC')}
    ${campoContrato('N°', arr1.doc || '')}
    ${campoContrato('Carta laboral vigencia', 'VIGENTE')}
    ${campoContrato('Correo electronico', arr1.email || '')}
    ${campoContrato('Telefono 1', arr1.tel || '')}
    ${campoContrato('Telefono 2', arr1.tel2 || '')}
    ${campoContrato('Cantidad rentada', '')}
    ${campoContrato('Direccion de residencia', arr1.dir || '')}
    ${campoContrato('Barrio', arr1.barrio || '')}
    ${campoContrato('Ciudad', arr1.ciudad || '')}
  </div>
  <div class="section-title">Informacion arrendatario 2</div>
  <div class="grid-4">
    ${campoContrato('Nombres', arr2.nombre || data.arr2 || 'NO APLICA')}
    ${campoContrato('Tipo ID', arr2.tipoId || 'NO APLICA')}
    ${campoContrato('N°', arr2.doc || 'NO APLICA')}
    ${campoContrato('Carta laboral', 'N/D')}
    ${campoContrato('Correo electronico', arr2.email || 'NO APLICA')}
    ${campoContrato('Telefono 1', arr2.tel || 'NO APLICA')}
    ${campoContrato('Telefono 2', arr2.tel2 || 'NO APLICA')}
    ${campoContrato('Cantidad rentada', '')}
    ${campoContrato('Direccion de residencia', arr2.dir || 'NO APLICA')}
    ${campoContrato('Barrio', arr2.barrio || 'NO APLICA')}
    ${campoContrato('Ciudad', arr2.ciudad || 'NO APLICA')}
  </div>
  <div class="section-title">Informacion vehiculo automotor</div>
  <div class="grid-6">
    ${campoContrato('Placa', moto.placa || data.moto)}
    ${campoContrato('Linea', moto.linea || moto.referencia || '')}
    ${campoContrato('Clase', moto.clase || 'MOTOCICLETA')}
    ${campoContrato('Cilindraje', moto.cilindraje || '')}
    ${campoContrato('# Motor', moto.motor || '')}
    ${campoContrato('Modelo', moto.modelo || '')}
    ${campoContrato('Marca', moto.marca || '')}
    ${campoContrato('Color', moto.color || '')}
    ${campoContrato('# Chasis', moto.chasis || '')}
    ${campoContrato('Soat vence', normalizarFechaParaMostrar(moto.vencimientoSoat), 'warn')}
    ${campoContrato('Tecnicomecanica vence', normalizarFechaParaMostrar(moto.vencimientoTecno), 'warn')}
    ${campoContrato('Pico y placa', 'DIAS LUNES CONSULTAR VIGENCIA Y VIAS EXENTAS')}
  </div>
  <div class="section-title">Informacion garantia</div>
  <div class="grid-5">
    ${campoContrato('Tipo de garantia', '')}
    ${campoContrato('Valor deposito moto', depositoTotal.toLocaleString('es-CO'))}
    ${campoContrato('Valor deposito accesorios', '')}
    ${campoContrato('Total deposito', depositoTotal.toLocaleString('es-CO'))}
    <div class="money-box">
      ${campoContrato('Total deposito y alquiler', (depositoTotal + totalAlquiler).toLocaleString('es-CO'))}
      ${campoContrato('Pagos realizados', (depositoPagado + pagadoAlquiler).toLocaleString('es-CO'))}
      ${campoContrato('Pendiente por pagar', (depositoTotal + saldoAlquiler).toLocaleString('es-CO'))}
    </div>
    ${campoContrato('Otro', '')}
    ${campoContrato('Medio de pago deposito', '')}
  </div>
  <div class="section-title">Informacion de tarifa</div>
  <div class="grid-5">
    ${campoContrato('Tipo de contrato', contrato.tipoContrato || 'CORTO')}
    ${campoContrato('Dias de alquiler', contrato.diasAlquiler || '')}
    ${campoContrato('Valor dia alquiler', totalAlquiler.toLocaleString('es-CO'))}
    ${campoContrato('Total a pagar alquiler', totalAlquiler.toLocaleString('es-CO'))}
  </div>
  <div class="section-title">Informacion de entrega</div>
  <div class="grid-6">
    ${campoContrato('Fecha', normalizarFechaParaMostrar(data.fecha), 'big')}
    ${campoContrato('Hora', data.hora, 'big')}
    ${campoContrato('Cascos', contrato.cascos || 0)}
    ${campoContrato('Chalecos', contrato.chalecos || 0)}
    ${campoContrato('Impermeables', contrato.impermeables || 0)}
    ${campoContrato('Gasolina', data.gasolina)}
    ${campoContrato('Limpieza', contrato.limpieza || 0)}
    ${campoContrato('Kilometraje', contrato.kilometraje || 0)}
    ${campoContrato('Llaves entregadas', data.llaves)}
    ${campoContrato('Matricula entregada', data.matricula)}
    ${campoContrato('Observacion o danos del vehiculo', data.novedades || data.observaciones)}
  </div>
  <div class="terms"><b>Certifico con mi firma que acepto:</b><br>
    1. He leido el contrato de arrendamiento y estoy de acuerdo con el.<br>
    2. El vehiculo presente se entrega en buenas condiciones esteticas y mecanicas.<br>
    3. He revisado el nivel de gasolina y limpieza del vehiculo entregado.<br>
    4. Si la motocicleta es retenida, certifico que he revisado y aceptado las condiciones.<br>
    5. Entiendo que debo responder por pinchazos, danos, comparendos y usos indebidos.<br>
    6. Conozco que RODEMOS rentara durante los dias habiles contados desde la entrega.<br>
  </div>
  <div class="signatures">
    <div class="sig-row"><div class="sig-line">FIRMA&nbsp;&nbsp;&nbsp; ${arr1.nombre || data.arr1}</div><div class="finger"></div></div>
    <div class="sig-row"><div class="sig-line">FIRMA&nbsp;&nbsp;&nbsp; ${arr2.nombre || data.arr2 || 'NO APLICA'}</div><div class="finger"></div></div>
  </div>
</section>
<section class="contract-page page-2">
  <h2>Terminos y condiciones del contrato ${data.codigo}</h2>
  <p>El arrendatario declara recibir el vehiculo descrito en la primera hoja a satisfaccion, con sus accesorios, documentos y elementos relacionados.</p>
  <p>Se obliga a devolverlo en el mismo estado en que fue recibido, salvo el desgaste normal por uso ordinario. Cualquier dano, comparendo, grua, parqueadero, inmovilizacion, perdida de documentos o accesorios sera asumido por el arrendatario.</p>
  <p>Los pagos, depositos, recargos, novedades y saldos quedan registrados en el sistema administrativo de RODEMOS INVERGROUP y forman parte integral del contrato.</p>
  <p>Observaciones: ${data.observaciones || 'Sin observaciones adicionales.'}</p>
  <br><br><br>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:80px;margin-top:80px;">
    <div style="border-top:1px solid #111;padding-top:8px;font-weight:900;">Arrendatario 1</div>
    <div style="border-top:1px solid #111;padding-top:8px;font-weight:900;">RODEMOS INVERGROUP</div>
  </div>
</section>
</body></html>`;
}

function normalizarFotosMotoGuardadas(fotos = {}) {
    const normalizadas = {
        lado1: fotos.lado1 || fotos.matricula || null,
        lado2: fotos.lado2 || null,
        tecno: fotos.tecno || null,
        soat: fotos.soat || null
    };
    Object.keys(normalizadas).forEach(key => {
        if (!normalizadas[key]) delete normalizadas[key];
    });
    return normalizadas;
}

function verDetalleMoto(idx) {
    motoSeleccionadaIdx = idx;
    const m = dbMotos[idx];
    if (!m) return;
    document.getElementById('detalle-moto').style.display = 'flex';
    document.getElementById('moto-modal-titulo').innerText = 'Ficha de moto';
    ['placa', 'marca', 'referencia', 'linea', 'clase', 'modelo', 'cilindraje', 'motor', 'chasis', 'color', 'soat', 'tecno'].forEach(f => {
        const key = f === 'soat' ? 'vencimientoSoat' : f === 'tecno' ? 'vencimientoTecno' : f;
        const el = document.getElementById(`mo-${f}`);
        if (el) el.value = m[key] || '';
    });
    const placaForm = document.getElementById('mo-form-placa');
    if (placaForm) placaForm.value = m.placa || '';
    motoFotosTemp = normalizarFotosMotoGuardadas(m.fotos || {});
    ['lado1', 'lado2', 'tecno', 'soat'].forEach(tipo => renderPreviewImagenMoto(tipo, motoFotosTemp[tipo]));
    actualizarAlertaMoto(m);
}

function construirMotoDesdeFormulario() {
    const placa = (document.getElementById('mo-form-placa')?.value || document.getElementById('mo-placa')?.value || '').toUpperCase().trim();
    return {
        placa,
        marca: document.getElementById('mo-marca')?.value.toUpperCase().trim() || '',
        referencia: document.getElementById('mo-referencia')?.value.toUpperCase().trim() || '',
        linea: document.getElementById('mo-linea')?.value.toUpperCase().trim() || '',
        clase: document.getElementById('mo-clase')?.value.toUpperCase().trim() || '',
        modelo: document.getElementById('mo-modelo')?.value.trim() || '',
        cilindraje: document.getElementById('mo-cilindraje')?.value.trim() || '',
        motor: document.getElementById('mo-motor')?.value.trim() || '',
        chasis: document.getElementById('mo-chasis')?.value.trim() || '',
        color: document.getElementById('mo-color')?.value.toUpperCase().trim() || '',
        vencimientoSoat: document.getElementById('mo-soat')?.value || '',
        vencimientoTecno: document.getElementById('mo-tecno')?.value || '',
        fotos: normalizarFotosMotoGuardadas(motoFotosTemp)
    };
}

function copiarImagenesMoto() {
    copiarImagenesAlPortapapeles(['lado1', 'lado2', 'tecno', 'soat'].map(tipo => motoFotosTemp[tipo]));
}

function setContadorEntrega(tipo, valor = 0) {
    const numero = Math.max(0, Math.min(2, Number(valor || 0)));
    const input = document.getElementById(`con-${tipo}`);
    const btn = document.getElementById(`con-${tipo}-btn`);
    if (input) input.value = String(numero);
    if (btn) {
        const labels = { cascos: 'Cascos', chalecos: 'Chalecos', impermeables: 'Impermeables' };
        btn.textContent = `${labels[tipo] || tipo}: ${numero}`;
        btn.classList.toggle('is-active', numero > 0);
    }
}

function cambiarContadorEntrega(tipo) {
    const actual = Number(document.getElementById(`con-${tipo}`)?.value || 0);
    setContadorEntrega(tipo, (actual + 1) % 3);
}

function valorContadorEntrega(tipo) {
    return Number(document.getElementById(`con-${tipo}`)?.value || 0);
}

var actualizarEstadoPasosContratoBaseNovedades = typeof actualizarEstadoPasosContratoBaseNovedades === 'undefined' ? actualizarEstadoPasosContrato : actualizarEstadoPasosContratoBaseNovedades;
actualizarEstadoPasosContrato = function(arrendatariosHabilitados, detallesHabilitados) {
    actualizarEstadoPasosContratoBaseNovedades(arrendatariosHabilitados, detallesHabilitados);
    ['con-cascos-btn', 'con-chalecos-btn', 'con-impermeables-btn', 'con-kilometraje'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = !detallesHabilitados;
    });
};

var limpiarFormularioContratoBaseNovedades = typeof limpiarFormularioContratoBaseNovedades === 'undefined' ? limpiarFormularioContrato : limpiarFormularioContratoBaseNovedades;
limpiarFormularioContrato = function() {
    limpiarFormularioContratoBaseNovedades();
    ['cascos', 'chalecos', 'impermeables'].forEach(tipo => setContadorEntrega(tipo, 0));
    const km = document.getElementById('con-kilometraje');
    if (km) km.value = '';
};

var obtenerContratoDesdeFormularioBaseNovedades = typeof obtenerContratoDesdeFormularioBaseNovedades === 'undefined' ? obtenerContratoDesdeFormulario : obtenerContratoDesdeFormularioBaseNovedades;
obtenerContratoDesdeFormulario = function() {
    const contrato = obtenerContratoDesdeFormularioBaseNovedades();
    if (!contrato) return contrato;
    const limpieza = document.querySelector('#con-estado-entrega .condition-option.active')?.dataset.value || 'LIMPIA';
    return {
        ...contrato,
        limpieza,
        cascos: valorContadorEntrega('cascos'),
        chalecos: valorContadorEntrega('chalecos'),
        impermeables: valorContadorEntrega('impermeables'),
        kilometraje: parseMoneyInput(document.getElementById('con-kilometraje')?.value || 0)
    };
};

var cargarContratoBaseNovedades = typeof cargarContratoBaseNovedades === 'undefined' ? cargarContrato : cargarContratoBaseNovedades;
cargarContrato = function(codigo) {
    cargarContratoBaseNovedades(codigo);
    const c = dbContratos.find(item => item.codigo === codigo);
    if (!c) return;
    ['cascos', 'chalecos', 'impermeables'].forEach(tipo => setContadorEntrega(tipo, c[tipo] || 0));
    const km = document.getElementById('con-kilometraje');
    if (km) km.value = Number(c.kilometraje || 0) ? Number(c.kilometraje || 0).toLocaleString('es-CO') : '';
};

function renderFacturas() {
    recalcularTodasFacturas();
    const contratos = contratosLargosActivos();
    const busqueda = normalizarBusqueda(document.getElementById('fact-busqueda')?.value || '');
    const tokens = busqueda.split(/\s+/).filter(Boolean);
    const estadoFiltro = document.getElementById('fact-filtro-estado')?.value || 'PENDIENTE';
    const filtrados = contratos.filter(c => {
        const texto = normalizarBusqueda(`${c.codigo || ''} ${c.arrendatario1 || ''} ${c.moto || ''}`);
        const okTexto = tokens.length ? tokens.every(t => texto.includes(t)) : true;
        const facturas = facturasContrato(c.codigo);
        const okEstado = estadoFiltro === 'EMITIDA'
            ? facturas.some(f => f.emitida)
            : estadoFiltro === 'PENDIENTE'
                ? (!facturas.length || facturas.some(f => !f.emitida))
                : true;
        return okTexto && okEstado;
    });
    const pendientes = dbFacturas.filter(f => !f.emitida);
    setTexto('fact-kpi-contratos', String(contratos.length));
    setTexto('fact-kpi-pendientes', String(pendientes.length));
    setTexto('fact-kpi-saldo', pendientes.reduce((t, f) => t + Math.max(0, Number(f.saldo || 0)), 0).toLocaleString('es-CO'));
    const body = document.getElementById('facturas-contratos-body');
    if (body) {
        body.innerHTML = filtrados.length ? filtrados.map(c => {
            const facturas = facturasContrato(c.codigo);
            const r = resumenFacturasContrato(c.codigo);
            const total = facturas.reduce((sum, f) => sum + Number(f.total || 0), 0);
            return `<tr>
                <td><b>${c.arrendatario1 || '-'}</b></td>
                <td>${c.moto || '-'}</td>
                <td>${c.codigo || '-'}</td>
                <td>${Number(total || r.cobroFactura || 0).toLocaleString('es-CO')}</td>
                <td>${Number(r.pagado || 0).toLocaleString('es-CO')}</td>
                <td>${formatoSaldo(r.saldo)}</td>
                <td class="doc-actions">
                    <button class="btn-listado" type="button" onclick="seleccionarContratoFacturas('${c.codigo}')">Revisar</button>
                    <button class="btn-listado danger" type="button" onclick="eliminarFacturaContratoCompleto('${c.codigo}')">Eliminar</button>
                </td>
            </tr>`;
        }).join('') : '<tr><td colspan="7" class="cliente-empty-row">No hay facturas con estos filtros.</td></tr>';
    }
    if (facturasContratoActual) renderDetalleFacturas();
}

function abrirModalIndicativo(inputId) {
    telefonoIndicativoDestino = inputId;
    const input = document.getElementById('telefono-indicativo-valor');
    if (input) input.value = '';
    document.getElementById('modal-indicativo-telefono')?.classList.add('show');
    setTimeout(() => input?.focus(), 50);
}

function cerrarFormularioCliente() {
    ocultarDetalleCliente();
    setEstadoDocumentos(true);
    const nombre = document.getElementById('cli-nombre');
    const doc = document.getElementById('cli-doc');
    if (nombre) nombre.value = '';
    if (doc) doc.value = '';
    ocultarBusqueda('area-coincidencias', 'btn-principal-crear');
    clientesPaginaActual = 1;
    renderClientesListado();
}

var selectorPaginaActual = typeof selectorPaginaActual === 'undefined' ? 1 : selectorPaginaActual;
var selectorUltimaBusqueda = typeof selectorUltimaBusqueda === 'undefined' ? '' : selectorUltimaBusqueda;
const SELECTOR_RESULTADOS_POR_PAGINA = 10;

var abrirSelectorEntidadBasePaginado = typeof abrirSelectorEntidadBasePaginado === 'undefined' ? abrirSelectorEntidad : abrirSelectorEntidadBasePaginado;
abrirSelectorEntidad = function(tipo, destino) {
    selectorPaginaActual = 1;
    abrirSelectorEntidadBasePaginado(tipo, destino);
    const resultados = document.getElementById('selector-resultados');
    if (resultados) resultados.classList.add('selector-compact-list');
};

function cambiarPaginaSelector(delta) {
    selectorPaginaActual = Math.max(1, selectorPaginaActual + delta);
    renderSelectorEntidad();
}

function renderSelectorEntidad() {
    if (!selectorActual) return;
    const inputBusqueda = document.getElementById('selector-busqueda');
    const q = normalizarBusqueda(inputBusqueda?.value || '');
    if (q !== selectorUltimaBusqueda) {
        selectorUltimaBusqueda = q;
        selectorPaginaActual = 1;
    }
    const tokens = q.split(/\s+/).filter(Boolean);
    const fuente = selectorActual.tipo === 'cliente' ? dbClientes : dbMotos;
    const resultados = fuente.filter(item => {
        if (selectorActual.tipo === 'cliente') {
            const texto = normalizarBusqueda(`${item.nombre || ''} ${item.doc || ''} ${item.tel || ''}`);
            return tokens.length ? tokens.every(token => texto.includes(token)) : true;
        }
        const texto = normalizarBusqueda(`${item.placa || ''} ${item.marca || ''} ${item.referencia || ''} ${item.linea || ''}`);
        return tokens.length ? tokens.every(token => texto.includes(token)) : true;
    });
    const contenedor = document.getElementById('selector-resultados');
    if (!contenedor) return;
    contenedor.classList.add('selector-compact-list');
    if (!resultados.length) {
        contenedor.innerHTML = '<div class="dashboard-empty">Sin coincidencias.</div>';
        return;
    }
    const totalPaginas = Math.max(1, Math.ceil(resultados.length / SELECTOR_RESULTADOS_POR_PAGINA));
    selectorPaginaActual = Math.min(selectorPaginaActual, totalPaginas);
    const inicio = (selectorPaginaActual - 1) * SELECTOR_RESULTADOS_POR_PAGINA;
    const pagina = resultados.slice(inicio, inicio + SELECTOR_RESULTADOS_POR_PAGINA);
    const filas = pagina.map(item => {
        const texto = selectorActual.tipo === 'cliente'
            ? `${item.nombre || '-'} · CC ${item.doc || '-'}`
            : `${item.placa || '-'} · ${item.marca || ''} ${item.referencia || ''}`.trim();
        const detalle = selectorActual.tipo === 'moto' ? estadoDocumentalMoto(item) : (item.email || item.tel || '');
        const id = item.id || item.doc || item.placa;
        return `<div class="dashboard-item">
            <div><strong>${texto}</strong><small>${detalle || '-'}</small></div>
            <button class="btn-listado" type="button" onclick="prepararConfirmacionSeleccion('${selectorActual.tipo}', '${selectorActual.destino}', '${id}')">Seleccionar</button>
        </div>`;
    }).join('');
    contenedor.innerHTML = `${filas}
        <div class="selector-pagination">
            <button class="btn-listado" type="button" onclick="cambiarPaginaSelector(-1)" ${selectorPaginaActual <= 1 ? 'disabled' : ''}>Anterior</button>
            <span>Pagina ${selectorPaginaActual} de ${totalPaginas}</span>
            <button class="btn-listado" type="button" onclick="cambiarPaginaSelector(1)" ${selectorPaginaActual >= totalPaginas ? 'disabled' : ''}>Siguiente</button>
        </div>`;
}

var inicializarFacturasBaseConsistente = typeof inicializarFacturasBaseConsistente === 'undefined' ? inicializarFacturas : inicializarFacturasBaseConsistente;
inicializarFacturas = function() {
    const filtro = document.getElementById('fact-filtro-estado');
    if (filtro) filtro.value = 'PENDIENTE';
    inicializarFacturasBaseConsistente();
    renderFacturas();
    setTimeout(() => {
        const filtroActual = document.getElementById('fact-filtro-estado');
        if (filtroActual && !filtroActual.value) filtroActual.value = 'PENDIENTE';
        renderFacturas();
    }, 80);
};

var marcarFacturaEmitidaBaseConsistente = typeof marcarFacturaEmitidaBaseConsistente === 'undefined' ? marcarFacturaEmitida : marcarFacturaEmitidaBaseConsistente;
marcarFacturaEmitida = function(id) {
    marcarFacturaEmitidaBaseConsistente(id);
    setTimeout(renderFacturas, 0);
};

var eliminarFacturaPorIdBaseConsistente = typeof eliminarFacturaPorIdBaseConsistente === 'undefined' ? eliminarFacturaPorId : eliminarFacturaPorIdBaseConsistente;
eliminarFacturaPorId = function(id) {
    eliminarFacturaPorIdBaseConsistente(id);
    setTimeout(renderFacturas, 0);
};

var eliminarFacturaContratoCompletoBaseConsistente = typeof eliminarFacturaContratoCompletoBaseConsistente === 'undefined' ? eliminarFacturaContratoCompleto : eliminarFacturaContratoCompletoBaseConsistente;
eliminarFacturaContratoCompleto = function(codigo) {
    eliminarFacturaContratoCompletoBaseConsistente(codigo);
    setTimeout(renderFacturas, 0);
};

document.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    const alerta = document.getElementById('modal-alerta');
    if (alerta?.classList.contains('show')) {
        event.preventDefault();
        cerrarAlerta();
    }
});

window.onload = () => loadPage(sessionStorage.getItem(LAST_PAGE_KEY) || 'inicio');








