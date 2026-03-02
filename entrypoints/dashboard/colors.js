/**
 * colors.js — Color Palette Assignment
 * Assigns palette colors to tree nodes so siblings don't share the same color.
 */

const Palette = [
    '#f472b6', '#c084fc', '#818cf8', '#22d3ee', '#34d399',
    '#a3e635', '#facc15', '#fb923c', '#f87171', '#e879f9',
    '#60a5fa', '#2dd4bf'
];

let colorMap = {};

/**
 * Traverse the app data tree and assign colors to all nodes.
 * Siblings at the same level are guaranteed different colors.
 * @param {Object} appData - { folders: [], chats: [] }
 */
export function assignColors(appData) {
    colorMap = {};

    const traverse = (parentId) => {
        const siblings = [
            ...appData.folders.filter(f => f.parentId === parentId),
            ...appData.chats.filter(c => c.parentId === parentId)
        ];

        const usedInLevel = new Set();
        siblings.forEach(item => {
            if (!colorMap[item.id]) {
                const available = Palette.find(c => !usedInLevel.has(c));
                colorMap[item.id] = available || Palette[Object.keys(colorMap).length % Palette.length];
            }
            usedInLevel.add(colorMap[item.id]);

            if (appData.folders.find(f => f.id === item.id)) {
                traverse(item.id);
            }
        });
    };

    traverse(null);
    return colorMap;
}

/**
 * @param {string} id
 * @returns {string} hex color string, fallback '#fff'
 */
export function getColor(id) {
    return colorMap[id] || '#fff';
}
