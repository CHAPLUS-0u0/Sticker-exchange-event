const url = "https://script.google.com/macros/s/AKfycbxKqkvvSDLWc2M6NkxzyMJ9_8DWPspAfQWUB6fOi6gVRDRmgvW50V9jzrX1uNWDTa9k/exec";

async function testGasGet() {
    console.log("Testing GET request to GAS...");
    try {
        const response = await fetch(`${url}?action=get`);
        console.log(`Status: ${response.status} ${response.statusText}`);

        let contentType = response.headers.get("content-type");
        console.log(`Content-Type: ${contentType}`);

        if (contentType && contentType.includes("application/json")) {
            const data = await response.json();
            console.log("Response JSON:", JSON.stringify(data).substring(0, 500) + "...");
        } else {
            const text = await response.text();
            console.log("Response text:", text.substring(0, 500) + "...");
        }
    } catch (e) {
        console.error("GET Error:", e.message);
    }
}

testGasGet();
