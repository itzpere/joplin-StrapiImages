import joplin from 'api';
import { SettingItemType, ToolbarButtonLocation } from 'api/types';

async function registerAllSettings() {
    const section = "StrapiImagesPlugin";

    await joplin.settings.registerSection(section, {
        label: "Strapi Images Plugin",
        description: "Settings for the Strapi Images Plugin",
        iconName: "fas fa-images"
    });

    await joplin.settings.registerSettings({
        "apiKey": { 
            public: true,
            section: section,
            type: SettingItemType.String,
            value: "",
            label: "API Key",
            description: "Enter your Strapi API key for the image upload service.",
        },
        "strapiUrl": {
            public: true,
            section: section,
            type: SettingItemType.String,
            value: "",
            label: "Strapi URL",
            description: "Enter the base URL of your Strapi instance (e.g., https://cms.itzpere.com).",
        },
        "joplinResourcesPath": {
            public: true,
            section: section,
            type: SettingItemType.String,
            value: "/home/pere/.config/joplin-desktop/resources",
            label: "Joplin Resources Path",
            description: "Enter the path to the Joplin resources directory.",
        }
    });
}

async function uploadImageToStrapi(apiKey, strapiUrl, imageData) {
    try {
        console.log('Image Data:', imageData);

        const resourcesPath = await joplin.settings.value('joplinResourcesPath');
        const filePath = `${resourcesPath}/${imageData.id}.${imageData.file_extension}`;
        console.log('File Path:', filePath);

        const fileData = await fetch(`file://${filePath}`).then(response => response.blob());

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

async function replaceImageLinkInNote(imageData, newUrl, strapiUrl) {
    try {
        console.log('New URL:', newUrl);

        const note = await joplin.workspace.selectedNote();
        if (!note || !note.body) throw new Error("Note content not found");

        console.log('Note Content:', note.body);

        let updatedBody = note.body;

        const oldLinkPattern = `!\\[${imageData.title}\\]\\(:\\/${imageData.id}\\)`;
        console.log('Old Link Pattern:', oldLinkPattern);

        const newLink = `![${imageData.title}](${strapiUrl}${newUrl})`;
        updatedBody = updatedBody.replace(new RegExp(oldLinkPattern, 'g'), newLink);

        console.log('Updated Body:', updatedBody);

        await joplin.data.put(['notes', note.id], null, { body: updatedBody });

        console.log(`Replaced image link: ${oldLinkPattern} -> ${newUrl}`);
    } catch (error) {
        console.error('Error replacing image link in note:', error);
    }
}

async function getImagesFromNote() {
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
}

async function fetchImagesFromStrapi(apiKey, strapiUrl) {
    const response = await fetch(`${strapiUrl}/api/upload/files`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
        }
    });

    if (!response.ok) {
        console.error('Failed to fetch images from Strapi:', response.statusText);
        return [];
    }

    const data = await response.json();
    console.log('Fetched images:', data);
    return data;
}

joplin.plugins.register({
    onStart: async function() {
        console.log('Strapi Images Plugin starting...');
        await registerAllSettings();

        await joplin.commands.register({
            name: 'uploadImages',
            label: 'Upload Images',
            iconName: 'fas fa-upload',
            execute: async () => {
                const apiKey = await joplin.settings.value('apiKey');
                const strapiUrl = await joplin.settings.value('strapiUrl');
                
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

                    const allImages = await fetchImagesFromStrapi(apiKey, strapiUrl);
                    console.log('All images in Strapi:', allImages);
                } else {
                    await joplin.views.dialogs.showMessageBox('No images found in the note.');
                }
            },
        });

        await joplin.views.toolbarButtons.create('uploadImagesButton', 'uploadImages', ToolbarButtonLocation.EditorToolbar);
    },
});
