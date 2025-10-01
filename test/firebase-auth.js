/* eslint-disable no-console */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  setPersistence,
  browserLocalPersistence,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

const statusEl = document.getElementById('authStatus');
const messageEl = document.getElementById('authMessage');
const userInfoEl = document.getElementById('userInfo');
const authFormsEl = document.getElementById('authForms');
const userEmailEl = document.getElementById('userEmail');
const userDisplayNameEl = document.getElementById('userDisplayName');
const userUidEl = document.getElementById('userUid');
const signOutBtn = document.getElementById('signOutBtn');
const registerForm = document.getElementById('registerForm');
const loginForm = document.getElementById('loginForm');
const googleBtn = document.getElementById('googleSignIn');

const setMessage = (text = '', variant = 'info') => {
  if (!messageEl) return;
  if (!text) {
    messageEl.hidden = true;
    messageEl.textContent = '';
    messageEl.removeAttribute('data-variant');
    return;
  }
  messageEl.hidden = false;
  messageEl.textContent = text;
  messageEl.setAttribute('data-variant', variant);
};

const toggleFormDisabled = (form, disabled) => {
  if (!form) return;
  form.querySelectorAll('input, button').forEach((element) => {
    element.disabled = disabled;
  });
};

let firebaseConfig;
try {
  const module = await import('./firebaseConfig.js');
  firebaseConfig = module.firebaseConfig;
  if (!firebaseConfig) throw new Error('firebaseConfig.js missing named export firebaseConfig');
} catch (error) {
  console.error('Firebase config not found. Copy firebaseConfig.sample.js to firebaseConfig.js', error);
  statusEl.textContent = 'Firebase config missing. Copy firebaseConfig.sample.js to firebaseConfig.js and add your project settings.';
  setMessage(error.message, 'error');
  throw error;
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

await setPersistence(auth, browserLocalPersistence);

const resetForms = () => {
  [registerForm, loginForm].forEach((form) => {
    if (!form) return;
    form.reset();
    toggleFormDisabled(form, false);
  });
};

const renderUserState = (user) => {
  if (user) {
    statusEl.textContent = 'Signed in';
    setMessage('', 'info');
    authFormsEl.hidden = true;
    userInfoEl.hidden = false;
    userEmailEl.textContent = user.email || '—';
    userDisplayNameEl.textContent = user.displayName || '—';
    userUidEl.textContent = user.uid;
  } else {
    statusEl.textContent = 'Not signed in';
    setMessage('Create an account or log in below.', 'info');
    authFormsEl.hidden = false;
    userInfoEl.hidden = true;
    userEmailEl.textContent = '—';
    userDisplayNameEl.textContent = '—';
    userUidEl.textContent = '—';
  }
};

onAuthStateChanged(auth, (user) => {
  renderUserState(user);
  if (!user) {
    resetForms();
  }
});

registerForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage('');
  const formData = new FormData(registerForm);
  const email = formData.get('email');
  const password = formData.get('password');
  toggleFormDisabled(registerForm, true);
  try {
    await createUserWithEmailAndPassword(auth, email, password);
    setMessage('Account created successfully.', 'info');
  } catch (error) {
    console.error('Registration failed', error);
    setMessage(error.message, 'error');
    toggleFormDisabled(registerForm, false);
  }
});

loginForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage('');
  const formData = new FormData(loginForm);
  const email = formData.get('email');
  const password = formData.get('password');
  toggleFormDisabled(loginForm, true);
  try {
    await signInWithEmailAndPassword(auth, email, password);
    setMessage('Logged in successfully.', 'info');
  } catch (error) {
    console.error('Login failed', error);
    setMessage(error.message, 'error');
    toggleFormDisabled(loginForm, false);
  }
});

googleBtn?.addEventListener('click', async () => {
  setMessage('');
  googleBtn.disabled = true;
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
    setMessage('Signed in with Google.', 'info');
  } catch (error) {
    console.error('Google sign-in failed', error);
    setMessage(error.message, 'error');
    googleBtn.disabled = false;
  }
});

signOutBtn?.addEventListener('click', async () => {
  setMessage('');
  signOutBtn.disabled = true;
  try {
    await signOut(auth);
    setMessage('Signed out.', 'info');
  } catch (error) {
    console.error('Sign-out failed', error);
    setMessage(error.message, 'error');
  } finally {
    signOutBtn.disabled = false;
  }
});
