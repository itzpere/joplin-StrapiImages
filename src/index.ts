// Import necessary modules and types
import joplin from 'api';
import { SettingItemType, ToolbarButtonLocation } from 'api/types';
import * as os from 'os';


// Constants for setting section and key names
const SECTION = "StrapiImagesPlugin";
const SETTING_API_KEY = "apiKey";
const SETTING_STRAPI_URL = "strapiUrl";
const SETTING_RESOURCES_PATH = "joplinResourcesPath";

// Register all settings for the plugin
async function registerAllSettings() {
    await joplin.settings.registerSection(SECTION, {
        label: "Strapi Images Plugin",
        description: "Settings for the Strapi Images Plugin",
        iconName: "fas fa-images"
    });

    await joplin.settings.registerSettings({
        [SETTING_API_KEY]: {
            public: true,
            section: SECTION,
            type: SettingItemType.String,
            value: "",
            label: "API Key",
            description: "Enter your Strapi API key for the image upload service.",
        },
        [SETTING_STRAPI_URL]: {
            public: true,
            section: SECTION,
            type: SettingItemType.String,
            value: "",
            label: "Strapi URL",
            description: "Enter the base URL of your Strapi instance (e.g., https://cms.example.com).",
        },
        [SETTING_RESOURCES_PATH]: {
            public: true,
            section: SECTION,
            type: SettingItemType.String,
            value: "~/.config/joplin-desktop/resources",
            label: "Joplin Resources Path",
            description: "Enter the path to the Joplin resources directory, use ~ for the home directory.",
        }
    });
}

// Replace ~ with the user's home directory in the file path
function expandHomeDir(path) {
    if (path.startsWith('~')) {
        return os.homedir() + path.slice(1);
    }
    return path;
}

// Upload image to Strapi
async function uploadImageToStrapi(apiKey, strapiUrl, imageData) {
    try {
        console.log('Image Data:', imageData);

        let resourcesPath = await joplin.settings.value(SETTING_RESOURCES_PATH);
        resourcesPath = expandHomeDir(resourcesPath);
        const filePath = `${resourcesPath}/${imageData.id}.${imageData.file_extension}`;
        console.log('File Path:', filePath);

        // Reading the image file from the local filesystem
        const fileData = await fetch(`file://${filePath}`).then(response => response.blob());

        // Creating FormData for the image upload
        const formData = new FormData();
        formData.append('files', fileData, imageData.title);

        console.log(`Uploading image to ${strapiUrl}/api/upload`);

        const response = await fetch(`${strapiUrl}/api/upload`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
            },
            body: formData
        });

        if (!response.ok) {
            console.error(`Failed to upload image. Status: ${response.status}, StatusText: ${response.statusText}`);
            return null;
        }

        const responseData = await response.json();
        console.log('Upload response:', responseData);
        return responseData;
    } catch (error) {
        console.error('Error during image upload:', error);
        return null;
    }
}

// Replace image link in the note with a new URL from Strapi
async function replaceImageLinkInNote(imageData, newUrl, strapiUrl) {
    try {
        console.log('New URL:', newUrl);

        const note = await joplin.workspace.selectedNote();
        if (!note || !note.body) throw new Error("Note content not found");

        let updatedBody = note.body;

        const oldLinkPattern = `!\\[${imageData.title}\\]\\(:\\/${imageData.id}\\)`;

        const newLink = `![${imageData.title}](${strapiUrl}${newUrl})`;
        updatedBody = updatedBody.replace(new RegExp(oldLinkPattern, 'g'), newLink);

        await joplin.data.put(['notes', note.id], null, { body: updatedBody });

    } catch (error) {
        console.error('Error replacing image link in note:', error);
    }
}

// Get image resources from the currently selected note
async function getImagesFromNote() {
    try {
        const note = await joplin.workspace.selectedNote();
        if (!note) return [];

        console.log(`Fetching resources for note: ${note.id}`);

        const imageResources = [];
        const resources = await joplin.data.get(['notes', note.id, 'resources']);
        for (let resource of resources.items) {
            const resourceData = await joplin.data.get(['resources', resource.id], { fields: ['id', 'title', 'file_extension', 'mime'] });
            if (resourceData.mime.startsWith('image/')) {
                imageResources.push(resourceData);
            }
        }
        return imageResources;
    } catch (error) {
        console.error('Error fetching images from note:', error);
        return [];
    }
}

// Plugin registration and command setup
joplin.plugins.register({
    onStart: async function() {
        console.log('Strapi Images Plugin starting...');
        await registerAllSettings();

        await joplin.commands.register({
            name: 'uploadImages',
            label: 'Upload Images',
            iconName: 'fas fa-upload',
            execute: async () => {
                const apiKey = await joplin.settings.value(SETTING_API_KEY);
                const strapiUrl = await joplin.settings.value(SETTING_STRAPI_URL);

                if (!apiKey || !strapiUrl) {
                    await joplin.views.dialogs.showMessageBox('Please set both the API key and Strapi URL in the plugin settings.');
                    return;
                }

                console.log('Fetching images from the note...');
                const images = await getImagesFromNote();

                if (images.length > 0) {
                    for (const image of images) {
                        console.log(`Uploading image: ${image.title}`);
                        const uploadResponse = await uploadImageToStrapi(apiKey, strapiUrl, image);

                        if (uploadResponse && uploadResponse[0] && uploadResponse[0].url) {
                            const newUrl = uploadResponse[0].url;
                            console.log(`Replacing link for image ${image.title} with ${newUrl}`);
                            await replaceImageLinkInNote(image, newUrl, strapiUrl);
                        }
                    }

                } else {
                    await joplin.views.dialogs.showMessageBox('No images found in the note.');
                }
            },
        });

        await joplin.views.toolbarButtons.create('uploadImagesButton', 'uploadImages', ToolbarButtonLocation.EditorToolbar);
    },
});
