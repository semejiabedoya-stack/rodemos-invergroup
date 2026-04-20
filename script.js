let dbClientes = JSON.parse(localStorage.getItem('motos_clientes')) || [];
let clienteSeleccionadoIdx = null;
let fotosTemp = {};

async function loadPage(page) {
    try {
        const response = await fetch(`SECTIONS/${page}.html`);
        document.getElementById('content-area').innerHTML = await response.text();
        
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.innerText.toLowerCase().includes(page)) btn.classList.add('active');
        });

        // --- CAMBIO 1: ACTIVAR DETECTOR AL CARGAR LA SECCIÓN ---
        if (page === 'clientes') {
            activarDetectorCedula();
        }

    } catch (e) { console.error("Error al cargar"); }
}

// --- FUNCIÓN DEL CAMBIO 1: AVISO INMEDIATO DE CÉDULA EXISTENTE ---
function activarDetectorCedula() {
    const inputDoc = document.getElementById('cli-doc');
    if (inputDoc) {
        // Se activa cuando el asesor sale del cuadro de texto (hace clic fuera)
        inputDoc.addEventListener('blur', function() {
            const cedulaIngresada = this.value.trim();
            if (cedulaIngresada === "") return;

            // Revisar si ya existe en la base de datos
            const existe = dbClientes.some(c => String(c.doc) === String(cedulaIngresada));

            if (existe) {
                // Mensaje inmediato en el centro de la pantalla
                alert(`⚠️ IDENTIFICACIÓN EXISTENTE: El cliente con CC ${cedulaIngresada} ya se encuentra registrado.\n\nRevise el listado o las coincidencias antes de continuar.`);
            }
        });
    }
}

function buscarCoincidencias() {
    const n = document.getElementById('cli-nombre').value.toUpperCase().trim();
    const d = document.getElementById('cli-doc').value.trim();
    const area = document.getElementById('area-coincidencias');
    const lista = document.getElementById('lista-resultados');
    const btnCrear = document.getElementById('btn-principal-crear');

    if (!n && !d) { area.style.display = "none"; btnCrear.style.display = "none"; return; }

    const terminos = n.split(" ").filter(t => t.length > 0);
    const filtrados = dbClientes.filter(c => (d && String(c.doc).includes(d)) || (terminos.length > 0 && terminos.every(t => c.nombre.includes(t))));

    if (filtrados.length > 0) {
        area.style.display = "block";
        btnCrear.style.display = "none";
        lista.innerHTML = filtrados.map(c => `
            <div class="doc-item" style="margin-bottom:8px">
                <div><strong>${c.nombre}</strong> <small>CC: ${c.doc}</small></div>
                <button onclick="verDetalle(${dbClientes.indexOf(c)})" class="btn-listado" style="padding:5px 15px">Ver</button>
            </div>
        `).join('');
    } else {
        area.style.display = "none";
        btnCrear.style.display = "block";
    }
}

function handleFile(input, key) {
    const reader = new FileReader();
    reader.onload = (e) => {
        fotosTemp[key] = e.target.result;
        input.parentElement.parentElement.style.borderColor = "var(--primary-red)";
        alert("¡Documento cargado!");
    };
    if(input.files[0]) reader.readAsDataURL(input.files[0]);
}

function iniciarCargaCelular(tipoDoc) {
    const modal = document.getElementById('modal-qr');
    const qrPlaceholder = document.getElementById('qr-img-placeholder');
    const cedulaCliente = document.getElementById('cli-doc').value;
    
    if(!cedulaCliente) return alert("Primero ingresa la cédula del cliente");

    const miIP = "192.168.1.8"; 
    const puerto = "5500"; 
    const urlParaCelular = `http://${miIP}:${puerto}/index.html?mode=camera&id=${cedulaCliente}`;
    
    qrPlaceholder.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(urlParaCelular)}" />`;
    document.getElementById('qr-desc').innerText = `Escanea para vincular cámara al cliente: ${cedulaCliente}`;
    modal.classList.add('show');
}

const bc = new BroadcastChannel('transferencia_fotos');
bc.onmessage = (event) => {
    fotosTemp = { ...fotosTemp, ...event.data };
    alert("✅ ¡Fotos recibidas desde el celular!");
    document.getElementById('modal-qr').classList.remove('show');
};

function openLightbox(key) {
    const src = clienteSeleccionadoIdx !== null ? dbClientes[clienteSeleccionadoIdx][key] : fotosTemp[key];
    if(!src) return alert("Sin imagen");
    document.getElementById('img-lightbox').src = src;
    document.getElementById('lightbox').style.display = "flex";
}

function verDetalle(idx) {
    clienteSeleccionadoIdx = idx;
    const c = dbClientes[idx];
    document.getElementById('detalle-completo').style.display = "block";
    document.getElementById('area-coincidencias').style.display = "none";
    
    ['nombre', 'doc', 'email', 'tel', 'dir', 'barrio'].forEach(f => {
        const el = document.getElementById('cli-' + f);
        if(el) {
            el.value = c[f] || "";
            el.readOnly = true;
        }
    });

    const btn = document.querySelector("#detalle-completo .btn-action");
    if(btn) {
        btn.innerText = "MODIFICAR CLIENTE";
        btn.style.background = "#000";
        btn.onclick = () => {
            ['nombre', 'doc', 'email', 'tel', 'dir', 'barrio'].forEach(f => {
                const el = document.getElementById('cli-' + f);
                if(el) el.readOnly = false;
            });
            btn.innerText = "GUARDAR CAMBIOS";
            btn.style.background = "var(--primary-red)";
            btn.onclick = guardarExistente;
        };
    }
}

function guardarExistente() {
    const idx = clienteSeleccionadoIdx;
    dbClientes[idx] = {
        ...dbClientes[idx],
        nombre: document.getElementById('cli-nombre').value.toUpperCase(),
        doc: document.getElementById('cli-doc').value,
        email: document.getElementById('cli-email').value,
        tel: document.getElementById('cli-tel').value,
        dir: document.getElementById('cli-dir').value,
        barrio: document.getElementById('cli-barrio').value,
        ...fotosTemp
    };
    localStorage.setItem('motos_clientes', JSON.stringify(dbClientes));
    location.reload();
}

function mostrarFormularioNuevo() {
    clienteSeleccionadoIdx = null;
    fotosTemp = {};
    document.getElementById('detalle-completo').style.display = 'block';
    document.getElementById('btn-principal-crear').style.display = 'none';
}

function validarYGuardarCliente() {
    const n = document.getElementById('cli-nombre').value.toUpperCase();
    const d = document.getElementById('cli-doc').value;
    if(!n || !d) return alert("Nombre y CC obligatorios");
    if(dbClientes.some(c => String(c.doc) === String(d))) return alert("La cédula ya existe");

    dbClientes.push({
        nombre: n, doc: d,
        email: document.getElementById('cli-email').value,
        tel: document.getElementById('cli-tel').value,
        dir: document.getElementById('cli-dir').value,
        barrio: document.getElementById('cli-barrio').value,
        ...fotosTemp
    });
    localStorage.setItem('motos_clientes', JSON.stringify(dbClientes));
    alert("✅ Registro guardado exitosamente");
    location.reload();
}

function abrirListado() {
    const tabla = document.getElementById('tabla-excel-body');
    dbClientes.sort((a,b) => a.nombre.localeCompare(b.nombre));
    tabla.innerHTML = dbClientes.map(c => `
        <tr>
            <td><b>${c.nombre}</b></td>
            <td>${c.doc}</td>
            <td>${c.tel || '-'}</td>
            <td>${c.barrio || '-'}</td>
            <td><button class="btn-listado" style="padding:2px 10px" onclick="cerrarModales(); verDetalle(${dbClientes.indexOf(c)})">🔍</button></td>
        </tr>
    `).join('');
    document.getElementById('modal-listado').classList.add('show');
}

function exportarExcel() {
    let csv = "\uFEFFNombre,Documento,Email,Telefono\n";
    dbClientes.forEach(c => csv += `"${c.nombre}","${c.doc}","${c.email}","${c.tel}"\n`);
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], {type:'text/csv;charset=utf-8;'}));
    link.download = "clientes_rodemos.csv";
    link.click();
}

function cerrarModales() { document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('show')); }

window.onload = () => loadPage('inicio');