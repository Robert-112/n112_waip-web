if (!window.PublicKeyCredential) {
  console.error("WebAuthn is not supported in this browser.");
} else {
  console.log("WebAuthn is supported.");
}


class Register {
    async init(event) {
        // 1. Get Challenge from server (Relying Party)
        const challenge = await this.getChallenge(event)
        console.log('1', challenge);
        // 2. Use challenge to create public key credential pair
        const credentials = await this.createPublicKeyPairWith(challenge)
        console.log('2');
        // 3. Send publicKey+challenge to server to create new user
        const currentUser = await this.loginWith(credentials)
        console.log('3');
        // 4. Redirect to user's dashboard
        this.redirect(currentUser)
    }

    async getChallenge(event) {
        const response = await fetch('/register/public-key/challenge', {
            method: 'POST',
            headers: {
                Accept: 'application/json',
            }, 
            body: new FormData(event.target),
        })

        return response.json()
    }

    async createPublicKeyPairWith(challengeResponse) {
        const options = {
            publicKey: {
                rp: { name: 'waippasskeys' },
                user: {
                    //id: base64url.decode(challengeResponse.user.id),
                    id: Uint8Array.from(challengeResponse.user.id, c => c.charCodeAt(0)),
                    name: challengeResponse.user.name,
                    displayName: challengeResponse.user.name,
                },
                challenge: Uint8Array.from(challengeResponse.challenge, c => c.charCodeAt(0)),
                //challenge: base64url.decode(challengeResponse.challenge),
                pubKeyCredParams: [
                    {
                        type: 'public-key',
                        alg: -7, // ES256
                    },
                    {
                        type: 'public-key',
                        alg: -257, // RS256
                    },
                    {
                        type: 'public-key',
                        alg: -8, // Ed25519
                    },
                ],
                authenticatorSelection: {
                    userVerification: 'preferred',
                },
                "timeout": 30000,
                //attestation: "direct",
            },
        }

        console.warn(options);

        try {
  //const credential = await navigator.credentials.create({ publicKey });
  const newCredentials = await navigator.credentials.create(options)
  console.log("Credential created:", newCredentials);
  return newCredentials
} catch (error) {
  console.error("Error creating credential:", error);
}

        //const newCredentials = await navigator.credentials.create(options)
        
    }

    buildLoginOptionsWith(userCredentials) {
        console.log(userCredentials);
        
        const body = {
            response: {
                clientDataJSON: base64url.encode(
                    userCredentials.response.clientDataJSON
                ),
                attestationObject: base64url.encode(
                    userCredentials.response.attestationObject
                ),
            },
        }

        if (userCredentials.response.getTransports) {
            body.response.transports =
            userCredentials.response.getTransports()
        }

        return body
    }

    async loginWith(userCredentials) {
        const options = this.buildLoginOptionsWith(userCredentials)

        const response = await fetch('/login/public-key', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(options)
        })

        return response.json()
    }

    redirect(currentUser) {
        window.location.href = currentUser.destination
    }
    
}

window.addEventListener('load', async () => {
    document
        .querySelector('#registration-form')
        .addEventListener('submit', async (event) => {
            event.preventDefault()

            const register = new Register()
            await register.init(event)
        })
})