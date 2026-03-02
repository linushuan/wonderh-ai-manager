/**
 * init.js — One-time initialisation helpers
 * (background image, etc.)
 */

/**
 * Tries to load background.jpg; applies it if found.
 */
export function initBackground() {
    const bgUrl = "../assets/background.jpg";
    const img = new Image();
    img.onload = () => {
        document.body.style.backgroundImage    = `url('${bgUrl}')`;
        document.body.style.backgroundSize     = "cover";
        document.body.style.backgroundPosition = "center";
        const welcome = document.getElementById('welcomeScreen');
        if (welcome) welcome.classList.add('has-bg');
    };
    // No onerror handler needed — missing background.jpg is fine
    img.src = bgUrl;
}
