const installButton = document.getElementById('installAppBtn');
const installDialog = document.getElementById('installDialog');
const closeInstallDialog = document.getElementById('closeInstallDialog');
const installNowButton = document.getElementById('installNowBtn');
const installInstructions = document.getElementById('installInstructions');

let deferredPrompt = null;
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = /iphone|ipad|ipod/i.test(window.navigator.userAgent);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch((error) => {
      console.warn('Service worker registration failed', error);
    });
  });
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredPrompt = event;
  if (installNowButton) installNowButton.hidden = false;
});

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  installDialog?.close();
  if (installButton) installButton.textContent = 'האפליקציה הותקנה';
  if (installButton) installButton.disabled = true;
});

if (installButton) {
  if (isStandalone) {
    installButton.textContent = 'מותקן במסך הבית';
    installButton.disabled = true;
  } else {
    installButton.addEventListener('click', () => {
      if (installInstructions) {
        installInstructions.innerHTML = isIOS
          ? 'ב־iPad או iPhone: לחץ על כפתור השיתוף בדפדפן, בחר <strong>הוסף למסך הבית</strong>, ואז אשר.'
          : 'אפשר להתקין את האפליקציה ממסך זה. לאחר ההתקנה היא תיפתח בחלון עצמאי כמו אפליקציה.';
      }
      if (installNowButton) installNowButton.hidden = !deferredPrompt;
      installDialog?.showModal();
    });
  }
}

closeInstallDialog?.addEventListener('click', () => installDialog?.close());
installDialog?.addEventListener('click', (event) => {
  if (event.target === installDialog) installDialog.close();
});

installNowButton?.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  installDialog?.close();
});
