import { db, auth } from "../firebase.js";
import { 
    collection, addDoc, serverTimestamp, doc, getDoc, updateDoc 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

import { requireAuth } from "../services/auth-guard.js";
import { showToast } from "../services/sweet-alert.js"; 

// --- DEDICATED UPLOADER WORKER ---
const UPLOADER_WORKER_URL = "https://interkun-uploader.interkunhq.workers.dev"; 

// --- STATE MANAGER ---
const state = {
    user: null,
    mode: 'new',      
    type: null,       
    docId: null,      
    files: { cover: null, mainFile: null, trailer: null },
    isSubmitting: false
};

// --- INIT ---
export async function init() {
    console.log("[PUBLISH] Engine V5 (Background Fast Upload) Loaded");
    try {
        state.user = await requireAuth();
        const hash = window.location.hash.split('?')[1] || "";
        const params = new URLSearchParams(hash);
        
        const editId = params.get('edit');
        const newType = params.get('type');

        if (editId) {
            state.mode = 'edit';
            state.docId = editId;
            await loadForEdit(editId);
        } else if (newType) {
            state.mode = 'new';
            window.selectType(newType);
        } else {
            showSelection();
        }

        setupListeners();
    } catch (e) {
        console.error("Init Error:", e);
    }
}

window.loadPublish = init;

// --- VIEW CONTROLLER ---
function showSelection() {
    document.getElementById('view-selection').classList.remove('hidden');
    document.getElementById('view-selection').classList.add('flex');
    document.getElementById('view-form').classList.add('hidden');
    document.getElementById('step-indicator').innerText = "Step 1 of 2";
}

window.selectType = (type) => {
    state.type = type;
    
    document.getElementById('view-selection').classList.remove('flex');
    document.getElementById('view-selection').classList.add('hidden');
    document.getElementById('view-form').classList.remove('hidden');
    document.getElementById('step-indicator').innerText = "Step 2 of 2";

    //  NAYA: 'audiobook' add kiya gaya hai
    const titles = { 'call': '1:1 Call', 'dm': 'Priority DM', 'digital': 'Digital File', 'webinar': 'Webinar', 'audiobook': 'Audio Course / Book' };
    document.getElementById('editor-heading').innerText = state.mode === 'edit' ? 'Edit Product' : `New ${titles[type]}`;
    document.getElementById('editor-badge').innerText = type.toUpperCase();

    // Sections hide/show logic
    ['call', 'dm', 'digital', 'webinar', 'audiobook'].forEach(t => {
        const el = document.getElementById(`section-${t}`);
        if(el) el.classList.add('hidden');
    });
    
    const activeSection = document.getElementById(`section-${type}`);
    if(activeSection) activeSection.classList.remove('hidden');

    // Naya feature: Har type mein Intro Audio ka option dikhana
    const introAudioSection = document.getElementById('section-intro-audio');
    if(introAudioSection) introAudioSection.classList.remove('hidden');

    if(state.mode === 'new') {
        document.getElementById('publish-form').reset();
        resetFiles();
    }
};

// --- EDIT LOADER ---
async function loadForEdit(id) {
    try {
        const snap = await getDoc(doc(db, "products", id));
        if(!snap.exists()) {
            showToast("Product not found", "error");
            return showSelection();
        }
        
        const data = snap.data();
        state.type = data.type;
        state.files.cover = data.coverImage;
        if(data.type === 'digital') state.files.mainFile = data.fileUrl;

        window.selectType(data.type);

        setValue('inp-title', data.title);
        setValue('inp-desc', data.description);
        setValue('inp-price', data.price);

        if(data.coverImage) {
            document.getElementById('preview-cover').src = data.coverImage;
            document.getElementById('preview-cover').classList.remove('hidden');
        }

        // ðŸš€ NAYA: Loading Calendar Data
        if(data.type === 'call') {
            setValue('inp-duration', data.duration);
            if(data.availability) {
                setValue('inp-start-time', data.availability.startTime);
                setValue('inp-end-time', data.availability.endTime);
                
                const days = data.availability.days || [];
                setValue('inp-days', JSON.stringify(days));
                
                document.querySelectorAll('.day-btn').forEach(btn => {
                    const dayVal = parseInt(btn.getAttribute('data-day'));
                    if(days.includes(dayVal)) {
                        btn.classList.add('bg-orange-500', 'text-white', 'border-orange-500');
                        btn.classList.remove('text-slate-500', 'bg-white');
                    }
                });
            }
        }
        if(data.type === 'dm') setValue('inp-response-time', data.responseTime);
        if(data.type === 'webinar') {
            setValue('inp-datetime', data.scheduledAt);
            setValue('inp-seats', data.maxSeats);
            setValue('inp-meet-link', data.meetLink); 
        }
        if(data.type === 'digital') {
            if(data.fileUrl) setFileUI('success', 'Existing File Attached');
            if(data.category) setValue('inp-category', data.category); 
        }

        document.getElementById('btn-submit').innerHTML = `Update <i class="fa-solid fa-check ml-2"></i>`;

    } catch(e) { console.error("Edit Load Error:", e); }
}

function setupListeners() {
    // 1. SABSE PEHLE form ko clean/clone karein (Taki purane duplicate listeners hat jayein)
    const form = document.getElementById('publish-form');
    if(form) {
        const newForm = form.cloneNode(true);
        form.replaceWith(newForm);
        // Ab fresh form par submit listener lagayein
        document.getElementById('publish-form').addEventListener('submit', handleSubmit);
    }

    // 2. AB FRESH ELEMENTS PAR LISTENERS LAGAYEIN
    
    // Cover Image Listener
    const inpCover = document.getElementById('inp-cover');
    if(inpCover) {
        inpCover.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if(file) {
                document.getElementById('preview-cover').src = URL.createObjectURL(file);
                document.getElementById('preview-cover').classList.remove('hidden');
            }
        });
    }

    // Category Selector Listener
    const inpCategory = document.getElementById('inp-category');
    if(inpCategory) {
        inpCategory.addEventListener('change', (e) => {
            const category = e.target.value;
            const fileInput = document.getElementById('inp-file');
            const formatHint = document.getElementById('file-format-hint');
            if(!fileInput) return;
            
            if (category === 'E-Books & Media') {
                fileInput.accept = "application/pdf, .pdf";
                if(formatHint) formatHint.innerText = "PDF ONLY";
            } else {
                fileInput.accept = ".zip,.rar,.pdf";
                if(formatHint) formatHint.innerText = "PDF, ZIP, RAR";
            }
            fileInput.value = "";
            setFileUI('default');
        });
    }

    // Main File Upload Listener (Digital Products)
    const inpFile = document.getElementById('inp-file');
    if(inpFile) {
        inpFile.addEventListener('change', (e) => {
            const file = e.target.files[0];
            const categorySelect = document.getElementById('inp-category');
            const category = categorySelect ? categorySelect.value : '';
            if(file) {
                if (category === 'E-Books & Media' && file.type !== 'application/pdf') {
                    showToast("E-Books me sirf PDF allow hai!", "error");
                    e.target.value = "";
                    setFileUI('default');
                    return;
                }
                setFileUI('success', file.name);
            }
        });
    }

    //  NAYA: Audiobook Episode File Change Listener (For default 1st episode)
    const firstEpInput = document.querySelector('.ep-file');
    if(firstEpInput) {
        firstEpInput.addEventListener('change', (e) => {
            if(e.target.files[0]) {
                const textSpan = e.target.parentElement.querySelector('span');
                textSpan.innerText = e.target.files[0].name;
            }
        });
    }

    //  NAYA: Add Episode Button Logic
    const btnAddEpisode = document.getElementById('btn-add-episode');
    if(btnAddEpisode) {
        btnAddEpisode.addEventListener('click', () => {
            const container = document.getElementById('episodes-container');
            const epCount = container.querySelectorAll('.episode-row').length + 1;
            
            const row = document.createElement('div');
            row.className = 'episode-row border border-slate-200 p-3 rounded-xl bg-slate-50 relative group mt-3';
            row.innerHTML = `
                <div class="flex justify-between items-center mb-2">
                    <input type="text" placeholder="Episode ${epCount} Title" class="ep-title w-full bg-white border border-slate-200 rounded-lg p-2 text-xs font-bold text-slate-800 outline-none focus:border-teal-400 mr-2">
                    <button type="button" class="text-red-500 hover:text-red-700 font-bold px-2 remove-ep"><i class="fa-solid fa-trash"></i></button>
                </div>
                <div class="relative w-full h-12 bg-white border border-dashed border-teal-200 rounded-lg flex items-center justify-center cursor-pointer hover:bg-teal-50 transition overflow-hidden">
                    <input type="file" accept="audio/*" class="ep-file absolute inset-0 opacity-0 cursor-pointer z-10 w-full">
                    <div class="flex items-center gap-2 text-teal-600">
                        <i class="fa-solid fa-file-audio text-sm"></i>
                        <span class="text-[10px] font-bold ep-file-text">Select Audio File</span>
                    </div>
                </div>
            `;
            container.appendChild(row);

            // Remove button logic
            row.querySelector('.remove-ep').addEventListener('click', () => row.remove());

            // File input logic for new rows
            const fileInput = row.querySelector('.ep-file');
            const fileText = row.querySelector('.ep-file-text');
            fileInput.addEventListener('change', (e) => {
                if(e.target.files[0]) {
                    fileText.innerText = e.target.files[0].name;
                }
            });
        });
    }

    //  CALENDAR DAYS BUTTON LOGIC
    const dayBtns = document.querySelectorAll('.day-btn');
    const inpDays = document.getElementById('inp-days');
    
    dayBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            btn.classList.toggle('bg-orange-500');
            btn.classList.toggle('text-white');
            btn.classList.toggle('border-orange-500');
            btn.classList.toggle('bg-white');
            btn.classList.toggle('text-slate-500');
            
            const selected = Array.from(document.querySelectorAll('.day-btn.bg-orange-500'))
                                  .map(b => parseInt(b.getAttribute('data-day')));
                                  
            if(inpDays) inpDays.value = JSON.stringify(selected);
        });
    });
}

// =========================================================
//   FAST BACKGROUND SUBMIT LOGIC (YouTube Style)
// =========================================================
function handleSubmit(e) {
    e.preventDefault();
    if(state.isSubmitting) return;

    try {
        const title = getValue('inp-title');
        const price = Number(getValue('inp-price'));
        
        if(!title) throw new Error("Title is required.");
        if(isNaN(price) || price < 0) throw new Error("Invalid Price.");

        let category = 'General';
        if (state.type === 'digital' || state.type === 'audiobook') {
            category = getValue('inp-category');
            if (!category && state.type === 'digital') throw new Error("Please select a valid category.");
        }

        // 1. Inputs Capture Karna
        const coverInput = document.getElementById('inp-cover')?.files[0];
        const fileInput = document.getElementById('inp-file')?.files[0];
        const trailerInput = document.getElementById('inp-trailer')?.files[0]; 
        const introAudioInput = document.getElementById('inp-intro-audio')?.files[0];

        //  NAYA: Audiobooks ke liye multiple episodes capture karna
        let rawEpisodes = [];
        if (state.type === 'audiobook') {
            document.querySelectorAll('.episode-row').forEach((row, index) => {
                const epTitle = row.querySelector('.ep-title').value || `Episode ${index + 1}`;
                const epFile = row.querySelector('.ep-file').files[0];
                if (epFile) {
                    rawEpisodes.push({ title: epTitle, file: epFile });
                }
            });
            if (rawEpisodes.length === 0 && state.mode === 'new') {
                throw new Error("Audiobooks require at least one episode with an audio file.");
            }
        } else if (state.type === 'digital' && state.mode === 'new' && !fileInput) {
            throw new Error("Digital products require a main file (PDF/ZIP).");
        }

        // 3. Payload Banana
        const payload = {
            sellerId: state.user.uid,
            type: state.type,
            title: title,
            description: getValue('inp-desc'),
            price: price,
            updatedAt: serverTimestamp()
        };

        // 4. Type-Specific Logic
        if(state.type === 'call') {
            payload.duration = Number(getValue('inp-duration')); 
            payload.platform = 'meet';
            
            const daysVal = getValue('inp-days');
            const daysArray = daysVal ? JSON.parse(daysVal) : [];
            if(daysArray.length === 0) throw new Error("Please select at least one available day.");
            
            payload.availability = {
                days: daysArray,
                startTime: getValue('inp-start-time'), 
                endTime: getValue('inp-end-time') 
            };
        }
        if(state.type === 'dm') {
            payload.responseTime = Number(getValue('inp-response-time')); 
            payload.msgLimit = 500; 
        }
        if(state.type === 'digital' || state.type === 'audiobook') { 
            payload.category = category || 'General'; 
        }
        if(state.type === 'webinar') {
            payload.scheduledAt = getValue('inp-datetime');
            payload.maxSeats = Number(getValue('inp-seats'));
            payload.meetLink = getValue('inp-meet-link');
        }

        // Temporary save episodes in payload for the worker to process
        if(state.type === 'audiobook') {
            payload.rawEpisodes = rawEpisodes;
        }

        // Submit state lock karna taki double click na ho
        state.isSubmitting = true;
        
        // Background Upload Start
        runBackgroundUploadAndSave(payload, coverInput, fileInput, trailerInput, introAudioInput, null, state.mode, state.docId);
        
        showToast("Publishing in background... You can continue working.", "success");
        window.location.hash = '#content'; 

    } catch(err) {
        showToast(err.message, "error");
        state.isSubmitting = false;
    }
}

// =========================================================
//   THE BACKGROUND ENGINE (Uploads + DB Save + Typesense)
// =========================================================
async function runBackgroundUploadAndSave(payload, coverInput, fileInput, trailerInput, introAudioInput, mainAudioInput, mode, editDocId) {
    // Progress Tracker UI
    const progressId = `upload-${Date.now()}`;
    createFloatingProgressUI(progressId, payload.title);

    try {
        let coverUrl = state.files.cover;     
        let fileUrl = state.files.mainFile;   
        let trailerUrl = state.files.trailer; 
        let introAudioUrl = state.files.introAudio || null; 

        // 1. Cover Image Upload (With Compression)
        if(coverInput) {
            updateProgressUI(progressId, 'Compressing Image...', 5);
            const compressedCover = await compressImage(coverInput, 800, 800, 0.7);
            
            updateProgressUI(progressId, 'Uploading Cover...', 10);
            coverUrl = await uploadViaWorkerWithProgress(compressedCover, "covers", (pct) => {
                updateProgressUI(progressId, `Uploading Cover (${pct}%)`, 10 + (pct * 0.1)); 
            }); 
        }

        // 2. Intro Audio Upload
        if(introAudioInput) {
            updateProgressUI(progressId, 'Uploading Intro Audio...', 25);
            introAudioUrl = await uploadViaWorkerWithProgress(introAudioInput, "audio-previews", (pct) => {
                updateProgressUI(progressId, `Uploading Intro (${pct}%)`, 25 + (pct * 0.15)); 
            });
        }

        // 3. Digital File Upload
        if(payload.type === 'digital' && fileInput) {
            updateProgressUI(progressId, 'Uploading Main File...', 45);
            fileUrl = await uploadViaWorkerWithProgress(fileInput, "secure-files", (pct) => {
                updateProgressUI(progressId, `Uploading Main File (${pct}%)`, 45 + (pct * 0.3)); 
            });
        }

        //  NAYA: Multiple Episodes Upload Logic
        if(payload.type === 'audiobook' && payload.rawEpisodes && payload.rawEpisodes.length > 0) {
            let uploadedChapters = [];
            const totalEps = payload.rawEpisodes.length;
            const progressPerEp = 35 / totalEps; // Reserve 35% of progress bar for episodes
            
            for(let i = 0; i < totalEps; i++) {
                let ep = payload.rawEpisodes[i];
                let baseProgress = 45 + (i * progressPerEp);
                
                updateProgressUI(progressId, `Uploading ${ep.title}...`, baseProgress); 
                
                let epUrl = await uploadViaWorkerWithProgress(ep.file, "secure-audio", (pct) => {
                    let currentOverall = baseProgress + ((pct / 100) * progressPerEp);
                    updateProgressUI(progressId, `Uploading ${ep.title} (${pct}%)`, currentOverall); 
                });
                
                uploadedChapters.push({ title: ep.title, fileUrl: epUrl });
            }
            
            // Attach chapters to payload and delete the raw files array
            payload.chapters = uploadedChapters;
            delete payload.rawEpisodes;
        }

        // 5. Digital Trailer Upload
        if(payload.type === 'digital' && trailerInput) {
            updateProgressUI(progressId, 'Uploading Trailer...', 80);
            trailerUrl = await uploadViaWorkerWithProgress(trailerInput, "trailers", (pct) => {
                updateProgressUI(progressId, `Uploading Trailer (${pct}%)`, 80 + (pct * 0.1)); 
            });
        }

        // Apply Generated URLs to Payload
        payload.coverImage = coverUrl || null;
        payload.introAudioUrl = introAudioUrl || null; 
        
        if(payload.type === 'digital') {
            payload.fileUrl = fileUrl || null;
            payload.trailerUrl = trailerUrl || null;
        }

        // 6. AUTO-GENERATE GOOGLE MEET LINK (WEBINAR)
        if (payload.type === 'webinar' && !payload.meetLink) {
            updateProgressUI(progressId, 'Generating Meet Link...', 90);
            try {
                const userDoc = await getDoc(doc(db, "users", payload.sellerId));
                const userData = userDoc.data();
                
                if (userData && userData.googleRefreshToken) {
                    const startTime = new Date(payload.scheduledAt);
                    const endTime = new Date(startTime.getTime() + 60 * 60 * 1000); 

                    const meetReq = await fetch("https://googlemeet.interkunhq.workers.dev/create-meeting", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            refreshToken: userData.googleRefreshToken,
                            startTime: startTime.toISOString(),
                            endTime: endTime.toISOString(),
                            summary: `Webinar: ${payload.title}`,
                            description: payload.description || "Webinar hosted on Interkun"
                        })
                    });

                    const meetRes = await meetReq.json();
                    if (meetRes.success) {
                        payload.meetLink = meetRes.meetLink;
                    } else {
                        throw new Error(meetRes.error || "Failed to generate Meet link");
                    }
                } else {
                    throw new Error("Google Meet not connected!");
                }
            } catch (meetErr) {
                throw new Error(meetErr.message);
            }
        }

        updateProgressUI(progressId, 'Saving to Database...', 95);

        let productId = editDocId;

        // 7. Save to Firebase
        if(mode === 'edit') {
            await updateDoc(doc(db, "products", editDocId), payload);
        } else {
            payload.createdAt = serverTimestamp();
            payload.sales = 0;
            payload.rating = 0;
            payload.isActive = true;
            
            const docRef = await addDoc(collection(db, "products"), payload);
            productId = docRef.id; 
        }

        // 8. Save to Typesense (Search Engine Sync)
        try {
            const SEARCH_WORKER_URL = "https://search.interkunhq.workers.dev"; 
            const searchData = {
                id: productId,
                title: payload.title,
                description: payload.description || "",
                price: parseFloat(payload.price),
                type: payload.type,
                thumbnail: payload.coverImage || "",
                sellerId: payload.sellerId
            };

            await fetch(`${SEARCH_WORKER_URL}/api/index-product`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(searchData)
            });
        } catch(searchErr) {
            console.error("Search Engine sync failed", searchErr);
        }

        // 100% Done -> Unlock Submit Button
        updateProgressUI(progressId, 'Published Successfully! ', 100);
        state.isSubmitting = false;
        setTimeout(() => removeProgressUI(progressId), 4000); 

    } catch(err) {
        console.error("Background Process Error:", err);
        updateProgressUI(progressId, 'Upload Failed ', 100, true);
        state.isSubmitting = false;
        setTimeout(() => removeProgressUI(progressId), 5000);
    }
}

// =========================================================
//   XHR UPLOADER (FOR EXACT 1%, 2% PERCENTAGE)
// =========================================================
async function uploadViaWorkerWithProgress(file, folderName, onProgress) {
    if (!file) return null;

    // FIX 1:            AWS   
    const cleanName = file.name.replace(/[^a-zA-Z0-9.\-]/g, '_');
    const safeFileName = `${folderName}/${Date.now()}-${cleanName}`;
    
    // FIX 2:     type     (Blank  ),     
    const fileType = file.type || 'audio/mpeg';

    try {
        // Step 1: Get presigned URL from Worker
        const res = await fetch(`${UPLOADER_WORKER_URL}/upload?fileName=${encodeURIComponent(safeFileName)}&fileType=${encodeURIComponent(fileType)}`);
        const { uploadUrl, publicUrl } = await res.json();

        // Step 2: Upload directly to AWS S3 using XHR to track progress
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("PUT", uploadUrl, true);
            
            //   fileType    
            xhr.setRequestHeader('Content-Type', fileType);
            
            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable) {
                    const percentComplete = Math.round((event.loaded / event.total) * 100);
                    onProgress(percentComplete);
                }
            };

            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve(publicUrl);
                } else {
                    reject(new Error("Upload failed to Cloud"));
                }
            };

            xhr.onerror = () => reject(new Error("Network Error"));
            xhr.send(file);
        });

    } catch (err) {
        throw new Error("Upload initialization failed");
    }
}

// =========================================================
// FLOATING PROGRESS UI (YouTube Style Notification)
// =========================================================
function createFloatingProgressUI(id, title) {
    let container = document.getElementById('global-upload-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'global-upload-container';
        container.className = 'fixed bottom-4 right-4 z-[9999] flex flex-col gap-3 w-80';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.id = id;
    toast.className = 'bg-slate-900 rounded-xl p-4 shadow-2xl border border-slate-700 transform transition-all duration-300 translate-y-0 opacity-100';
    
    toast.innerHTML = `
        <div class="flex justify-between items-center mb-2">
            <span class="text-white text-xs font-bold truncate pr-2">${title}</span>
            <span id="${id}-text" class="text-blue-400 text-[10px] font-black tracking-wider uppercase">0%</span>
        </div>
        <div class="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
            <div id="${id}-bar" class="bg-gradient-to-r from-blue-500 to-teal-400 h-1.5 rounded-full transition-all duration-300 ease-out" style="width: 0%"></div>
        </div>
        <p id="${id}-status" class="text-slate-400 text-[10px] mt-2 font-medium">Starting upload...</p>
    `;
    container.appendChild(toast);
}

function updateProgressUI(id, statusText, percent, isError = false) {
    const bar = document.getElementById(`${id}-bar`);
    const txt = document.getElementById(`${id}-text`);
    const sts = document.getElementById(`${id}-status`);
    
    if(bar && txt && sts) {
        bar.style.width = `${Math.min(percent, 100)}%`;
        txt.innerText = `${Math.floor(percent)}%`;
        sts.innerText = statusText;

        if (isError) {
            bar.classList.replace('from-blue-500', 'from-red-500');
            bar.classList.replace('to-teal-400', 'to-orange-500');
            txt.classList.replace('text-blue-400', 'text-red-400');
        } else if (percent >= 100) {
            bar.classList.replace('from-blue-500', 'from-green-500');
            bar.classList.replace('to-teal-400', 'to-emerald-400');
            txt.classList.replace('text-blue-400', 'text-green-400');
        }
    }
}

// =========================================================
//  IMAGE COMPRESSOR (Client-Side)
// =========================================================
async function compressImage(file, maxWidth = 800, maxHeight = 800, quality = 0.7) {
    return new Promise((resolve) => {
        // Agar file image nahi hai, toh wahi return kar do
        if (!file || !file.type.startsWith('image/')) {
            return resolve(file); 
        }

        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = event => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                let width = img.width;
                let height = img.height;

                // Dimension logic (Max 800px)
                if (width > height) {
                    if (width > maxWidth) {
                        height = Math.round((height *= maxWidth / width));
                        width = maxWidth;
                    }
                } else {
                    if (height > maxHeight) {
                        width = Math.round((width *= maxHeight / height));
                        height = maxHeight;
                    }
                }

                // Canvas par draw karke compress karna
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // JPEG me convert karna (quality: 0.7 means 70%)
                canvas.toBlob((blob) => {
                    if(!blob) return resolve(file); 
                    
                    // Nayi compressed file banana
                    const compressedFile = new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".jpg", {
                        type: 'image/jpeg',
                        lastModified: Date.now()
                    });
                    resolve(compressedFile);
                }, 'image/jpeg', quality);
            };
            img.onerror = () => resolve(file);
        };
        reader.onerror = () => resolve(file);
    });
}

function removeProgressUI(id) {
    const toast = document.getElementById(id);
    if(toast) {
        toast.classList.add('translate-y-4', 'opacity-0');
        setTimeout(() => toast.remove(), 300);
    }
}

// --- UTILS ---
function resetFiles() {
    state.files = { cover: null, mainFile: null, trailer: null }; 
    document.getElementById('preview-cover').src = '';
    document.getElementById('preview-cover').classList.add('hidden');
    setFileUI('default');
}

function setFileUI(status, text) {
    const elDefault = document.getElementById('file-ui-default');
    const elSuccess = document.getElementById('file-ui-success');
    
    if(status === 'success') {
        elDefault.classList.add('hidden');
        elSuccess.classList.remove('hidden');
        elSuccess.classList.add('flex');
        document.getElementById('file-name').innerText = text;
    } else {
        elDefault.classList.remove('hidden');
        elSuccess.classList.add('hidden');
        elSuccess.classList.remove('flex');
    }
}

const getValue = (id) => document.getElementById(id)?.value.trim();
const setValue = (id, val) => { const el = document.getElementById(id); if(el) el.value = val || ''; };
