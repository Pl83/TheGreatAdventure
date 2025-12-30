const factions = [
    {name: "Valarjar", text: "Proud warriors who died in battle and were taken to Asgard by the Valkyries. They now serve Odin for eternity.", alignment: "lawful good", slug: "valarjar"},
    {name: "Helarjar", text: "Unworthy warriors, brought back from the dead and imbued with anti-magic by Hela. They serve her forever.", alignment: "lawful evil", slug: "helarjar"},
    {name: "Elves Kingdom", text: "A noble race that lives in peace in the forest. They prefer to stay away from the chaos of the world.", alignment: "lawful neutral", slug: "elves-kingdom"},
    {name: "Ninjas", text: "Trained by Master Wu, they are the protectors of Ninjago.", alignment: "lawful neutral", slug: "ninjas"},
    {name: "The Imperium", text: "A high-tech empire that seeks to enslave dragons and harness their power.", alignment: "lawful evil", slug: "the-imperium"},
    {name: "Swamp Tribe", text: "A powerful tribe of human warriors who admire the Serpentine. They carry weapons imbued with deadly poison and live in swamps.", alignment: "chaotic neutral", slug: "swamp-tribe"},
    {name: "The Guild", text: "An organization that gathers adventurers from all over the world. They help people in exchange for rewards. They follow the law and have a moral code.", alignment: "lawful neutral", slug: "the-guild"},
    {name: "Mercenaries", text: "An organization formed by a man banned from the Guild. They have no ethics and will do anything for the right reward.", alignment: "neutral neutral", slug: "mercenarys"},
    {name: "Sky Pirates", text: "A group of pirates who have found weapons allowing them to master the wind.", alignment: "chaotic neutral", slug: "sky-pirates"},
    {name: "Nexo-Knights Kingdom", text: "A place where magic and technology merged to create Nexo Power. The knights of this kingdom are some of the bravest warriors in the universe.", alignment: "lawful neutral", slug: "nexo-knights-kingdom"},
    {name: "Skeletons", text: "Created by a powerful witch who wanted to overcome death. Only magic can defeat them since they are immune to physical damage.", alignment: "neutral evil", slug: "squeletons"},
    {name: "Dwarves Kingdom", text: "The best blacksmiths in the universe. They live in a giant city under mountains and, although they can seem a little cold from the outside, they are really friendly.", alignment: "lawful neutral", slug: "dwarves-kingdom"},
    {name: "Space", text: "Ninjago City's space agency. They send satellites, conduct scientific research, and have an advanced base on Mars.", alignment: "lawful neutral", slug: "space"},
    {name: "Heroes of Ninjago", text: "Created by Dr. Doom, this association gathers people with special abilities to protect Ninjago City and its citizens.", alignment: "lawful good", slug: "heros-of-ninjago"},
    {name: "Ghost", text: "A group of ghosts in the order of Morrow. Only magic can harm them, and they can possess living people.", alignment: "neutral evil", slug: "ghost"},
    {name: "Swarms", text: "An insectoid alien species. They multiply quickly and overwhelm everything. They seek galactic domination.", alignment: "chaotic evil", slug: "swarms"},
    {name: "Martians", text: "An alien species that lives on Mars. They are a peaceful species that seek to understand the universe.", alignment: "lawful neutral", slug: "martians"},
    {name: "Brainiacs", text: "A super-intelligent alien species. They possess advanced technology and seek galactic domination.", alignment: "neutral evil", slug: "brainiacs"},
    {name: "Mandalorian Tribe", text: "A tribe of proud warriors who follow the Way of Mandalore. They would rather die than remove their helmets and show their faces. They are also the only civilization with the knowledge to forge Beskar, the strongest metal.", alignment: "true neutral", slug: "mandalorian-tribe"},
    {name: "The Horde", text: "Multiple tribes of monsters have united to form a horde.", alignment: "chaotic evil", slug: "the-horde"},
    {name: "The Infernos", text: "A group of monsters who obey the Enchantress, a powerful sorceress. The Enchantress gave them the ability to regenerate and return forever.", alignment: "chaotic evil", slug: "the-infernos"},
    {name: "The Destruction", text: "Those who serve Siegfried, the avatar of destruction. Their only goal is to destroy everything that exists down to the last atom.", alignment: "chaotic evil", slug: "the-destruction"},
    {name: "Nightmare", text: "Trapped in the dark realm, they serve the Nightmare King.", alignment: "chaotic evil", slug: "nightmare"},
    {name: "Ice Shogun", text: "Created by the Ice Tribes and the power of the Forbidden Scroll, the Ice Shogun is a powerful warrior who can control Ice Chi. He created an army of ice samurais.", alignment: "lawful evil", slug: "ice-shogun"},
    {name: "Island Ruler", text: "An isolated tribe that was given the mission to protect the Thunder Key that could awaken Wojira. Long ago, they fell into insanity due to the corrupting power of the key, which they now worship.", alignment: "chaotic evil", slug: "island-ruler"},
    {name: "Jedi Temple", text: "The Jedi Temple is an intergalactic institution that tries to keep peace across the galaxy. Jedi usually prefer to resolve conflicts through mediation rather than violence. They follow a code, carry a lightsaber, and harness the Force to aid them.", alignment: "lawful good", slug: "jedi-temple"},
    {name: "Sith Congregation", text: "Sith have no morals or code; they only seek power and destruction. Unlike Jedi, they try to control and dominate the Force. They usually bleed their Kyber crystals to make their lightsabers red.", alignment: "chaotic evil", slug: "sith-congregation"},
    {name: "Phoenix Tribe", text: "An animal tribe that gained consciousness after drinking pure Chi. The oldest Chima tribe and the creator of Fire Chi. They live on top of the sacred mountain and only reveal themselves when the Ice Tribes try to conquer Chima.", alignment: "lawful good", slug: "pheonix-tribe"},
    {name: "Lion Tribe", text: "An animal tribe that gained conscience after drink pure Chi. The Lion in charge of the sacred pond and give a just amount of Chi to each tribe. They are noble, proud and loyal.", alignment: "lawfull neutral", slug: "lion-tribe"},
    {name: "Crocodile Tribe", text: "An animal tribe that gained conscience after drink pure Chi. Violent warriors, the crocodiles are also the best know swimmer and the second largest Chima tribe next to the Lion. The relation between the two are always tense due to their difference in value.", alignement: "chaotic neutral", slug: "crocodile-tribe"},
    {name: "Eagle Tribe", text: "An animal tribe that gained conscience after drink pure Chi. The eagle tribe is mainly composed of erudite and pacifist. They love knowledge and have one of the best library.", alignment: "lawfull neutral", slug: "eagle-tribe"},
    {name: "Wolve Tribe", text: "An animal tribe that gained conscience after drink pure Chi. The wolves are the only Nomad tribe, they share a strong bond between each other.", alignment: "chaotic neutral", slug: "wolve-tribe"},
    {name: "Gorilla Tribe", text: "An animal tribe that gained conscience after drink pure Chi. They like to chill. Gorilla are either eating, exercising or sleeping. They also adopted  the two last members of the Rhino Tribe.", alignment: "chaotic neutral", slug: "gorilla-tribe"},
    {name: "Bear Tribe", text: "An animal tribe that i conscience after drink pure Chi. They send most of their time sleeping. They only get up for important things such as honey, salmon or an invasion from the Ice Tribes.", alignment: "neutral good", slug: "bear-tribe"},
    {name: "Raven Tribe", text: "An animal tribe that gained conscience after drink pure Chi. The most cupid tribe in Chima. They will do anything for Gold.", alignment: "neutral evil", slug: "raven-tribe"},
    {name: "Snake Tribe", text: "An animal tribe that gained conscience after drink pure Chi. The snake tribe where banned long ago from Chima. Throughout generation, they forgot their origins and Chi. Each of the subspecies possesses powerful venom with various effects. After their banishment, they established them self on the continent of ninjago.", alignment: "chaotic neutral", slug: "snake-tribe"},
    {name: "Sea Tribe", text: "An animal tribe that gained conscience after drink pure Chi. They live deep in the sea and usually stay hidden, away from the conflict of the surface.", alignment: "chaotic neutral", slug: "sea-tribe"},
    {name: "Insectoid Tribe", text: "An animal tribe that gained conscience after drink pure Chi. For the last 300 years they were trapped inside a crevice deep inside a cave. Only recently did they manage to find and exit and regain their freedom.", alignment: "chaotic neutral", slug: "insectoid-tribe"},
    {name: "Tiger Tribe" ,text:"An animal tribe that gained conscience after drink pure Chi. Long ago, to accomplish a mission, the Tiger tribe decided to leave Chima. The descended from this tribe, have now forgotten their origin, their mission, the Chi and turned toward a new source of power. Last time they were seen they were working with the Imperium.", alignment: "chaotic neutral", slug: "tiger-tribe"},
    {name: "Vulture Tribe", text: "An animal tribe that gained conscience after drink pure Chi. After their death unknown magic allowed them to become undead, give them the ability to create Ice Chi the perfect opposite of Fire Chi. They now aim to freeze the entire world. They don't need to sleep, eat or breath and feel no pain. Fire is the only way to fight them. They love to prey on the weak and torment people. The are the fastest Ice Tribe.", alignment: "neutral evil", slug: "vulture-tribe"},
    {name: "Polar-Bear Tribe", text: "An animal tribe that gained consciousness after drinking pure Chi. After their deaths, unknown magic allowed them to become undead, granting them the ability to create Ice Chi—the perfect opposite of Fire Chi. They now aim to freeze the entire world. They don't need to sleep, eat, or breathe and feel no pain. Fire is the only way to fight them. Composed of the strongest warriors, this tribe lives to fight.", alignment: "neutral evil", slug: "polar-bear-tribe"},
    {name: "Sabertooth Tribe", text: "An animal tribe that gained consciousness after drinking pure Chi. After their deaths, unknown magic allowed them to become undead, granting them the ability to create Ice Chi—the perfect opposite of Fire Chi. They now aim to freeze the entire world. They don't need to sleep, eat, or breathe and feel no pain. Naturally talented with the sword, they are incredible swordsmen.", alignment: "neutral evil", slug: "sabertooth-tribe"},
    {name: "Wolf Clan", text: "The Wolf Clan were a cult formed by the Forbidden Five millennia ago. They were reassembled by Lord Ras to aid him in his quest to conquer the Merged Realms on behalf of his master. They attempted to release the Forbidden Five in the Ritual of the Blood Moon", alignment: "neutral evil", slug: "wolf-clan"}
];

const realms = [
    {name:"Origine's realm", size:"Major", description:"The first realm and the bigest. It served as the base realm during the Great Merge.", slug:"origine-realm"},
    {name:"Asgard", size:"Minor", description:"Realm created by Odin when he assended to Godhood.", slug:"asgard"},
    {name:"Helheim", size:"Minor", description:"Realm created by Hella when she assended to Godhood.", slug:"helheim"},
    {name: "The Imperium", size:"Medium", description:"A hight tech realm. They aim to enslave the dragon and harness theire power. It was merger to the origine realm during the Great Merge.", slug:"the-imperium"},
    {name: "The Underworld", size:"Medium", description:"A realm of darkness and death. It was merged to the origine realm during the Great Merge.", slug:"the-underworld"},
    {name: "The cloud kingdom", size:"Minor", description:"A realm of eternal light. It was merged to the origine realm during the Great Merge.", slug:"the-cloud-kingdom"},
    {name: "Wyldness", size:"Medium", description:"A land free of humanity. It contain one of the rarest resource : the Chi. It was merged to the origine realm during the Great Merge.", slug:"wyldness"},
];

const worlds = [
    {name:"Alfeim", realm:"Origine's realm", system:"Bc-586", nbStars:"1", description:"Composed of three continents separated by vast sea it's home to multiple civilisation.", slug:"alfeim"},
    {name:"Ruin's of TeamGuard", realm:"Origine's realm", system:"Bc-586", nbStars:"1", description:"After the betraille of Bellion, the plannet was first vitrified. Then a couple years after an explosion of unkown origine destroid it.", slug:"ruin-of-teamgard"},
    {name: "Mandalore", realm:"Origine's realm", system:"système Mandalore", nbStars:"2", description:"A desertic plannet with multiple tribe of warrior who never remove their helmet.", slug:"mandalore"},
    {name: "Korriban", realm:"Origine's realm", system:"système Mandalore", nbStars:"2", description:"A plannet of dark side, a place of pelgrimage for the sith.", slug:"korriban"},
    {name: "Corusant", realm:"Origine's realm", system:"Argon", nbStars:"1", description:"The capital of the galactic federation and a city planet. It also accommodate the Jedi temple.", slug:"corusant"},
    {name: "Earth", realm:"Origine's realm", system:"Sol", nbStars:"1", description:"The cradle of humanity.", slug:"earth"},
    {name: "Mars", realm:"Origine's realm", system:"Sol", nbStars:"1", description:"The red plannet.", slug:"mars"},
    {name: "Niflheim", realm:"Wyldness", system:"none", nbStars:"0", description:"Now a world of ice and permanent night, it was once a world full of life. The Chi originate from this place, and created antropomarphique animals.", slug:"niflheim"},
    {name: "Asgard", realm:"Asgard", system:"none", nbStars:"1", description:"Only world of it's realm, it's not a planet but a fragment of one that separed it self from the planet during the treachery of Hela.", slug:"asgard"},
    {name: "Helheim", realm:"Helheim", system:"none", nbStars:"0", description:"Only world of it's realm. A planet with a hole the size of a continent, it was once an eden. Now it's only a dead world.", slug:"helheim"},
    {name: "Musphelheim", realm:"Origine's realm", system:"Cf-864", nbStars:"10", description:"A world of fire and lava, no life can survive there.", slug:"musphelheim"},
    {name: "Tenut", realm:"Origine's realm", system:"Jx-843", nbStars:"2", description:"Planets of origine of the Brainiacs, the planet died long ago as they harvested everything in theire systeme from the planets to the star.", slug:"tenut"},
    {name: "Mentu", realm:"Origine's realm", system:"Jx-843", nbStars:"2", description:"Planets of origine of the Swarm, they quickly moved away after the death of there system, starting to colonize systeme after system.", slug:"mentu"},
];

const continents = [
    {name: "Nidavelir", world: "Alfeim", realm:"Origine's realm", description:"Mountaigne chaine", slug:"nidavelir"},
    {name: "Vanaheim", world: "Alfeim", realm:"Origine's realm", description:"Primordial forest", slug:"vanaheim"},
    {name: "Midgard", world: "Alfeim", realm:"Origine's realm", description:"forest and plain", slug:"midgard"},
    {name: "Ninjago", world: "Earth", realm:"Origine's realm", description:"The first half of the pangea. It was separated by the first spinzutsu master.", slug:"ninjago"},
    {name: "Dark Island", world: "Earth", realm:"Origine's realm", description:"The second half of the pangea. It was separated by the first spinzutsu master.", slug:"dark-island"},
];

const citys = [
    {name:"Erebor", continents: "Nidavelir", world:"Alfeim", realm: "Origine's realm", description:"Capital of the Dwarf Kingdom", slug:"erebor"},
    {name:"Tendrasyl", continents: "Vanaheim", world:"Alfeim", realm: "Origine's realm", description:"Capital of the Elven Kingdom", slug:"tendrasyl"},
    {name:"Duranmoran", continents: "Midgard", world:"Alfeim", realm: "Origine's realm", description:"Head quarter of the adventurer guild", slug:"duranmoran"},
    {name:"Camelot", continents: "Midgard", world:"Alfeim", realm: "Origine's realm", description:"New capital of the Nexo-Kinght Kingdom", slug:"camelot"},
    {name:"Ninjago City", continents: "Ninjago", world:"Earth", realm: "Origine's realm", description:"Capital of Ninjago", slug:"ninjago-city"},
    {name:"Stiix", continents: "Ninjago", world:"Earth", realm: "Origine's realm", description:"City of the swamp tribe", slug:"stiix"},
    {name: "Ever lasting city", continents:"none", world:"Niflheim", realm:"Origine's realm", description:"Home to the saber tooth, the vultur's, the polar bear and the frost samourai's. It's made of ever lasting ice.", slug:"ever-lasting-city"},
    {name: "Asgard", continents:"none", world:"Asgard", realm:"Asgard", description:"Last city of a dead world. Made of pure gold, it's home to Odin and his valarjar.", slug:"asgard"},
    {name: "Skyr", continents:"none", world:"Helheim", realm:"Helheim", description:"A bastion made of a black and green rock swelling anti-magic. It's the pallace of Hela.", slug:"skyr"},
    {name: "The living castle", continents:"none", world:"Musphelheim", realm:"Origine's realm", description:"A living castle made by the enchanteress, she can move it anywhere.", slug:"the-living-castle"},
    {name: "Dalaran", continents:"none", world:"none", realm:"Origine's realm", description:"The city of the mages, floating in the infinity of space.", slug:"dalaran"},
    {name: "Temut"}
];

const artifacts = [
    {name: "Shield of Nyx", divinity: "Nyx", power: "Indestrutible shield, that can absorb any attack.", slug: "shield-of-nyx", status: "Held by La Créatrice", autority: 7},
    {name: "On/Off Staff", divinity: "La Créatrice", power: "Allow to turn any reliques on or off.", slug: "on-off-staff", status: "Held by Héla", autority: 5},
    {name: "The Hammer of Creation", divinity: "La Créatrice", power: "Allow to create anything.", slug: "the-hammer-of-creation", status: "Held by La Créatrice", autority: 6},
    {name: "Tridents of Poseidon", divinity: "Poseidon", power: "Allow to controlle sea creature and manipulate water.", slug: "tridents-of-poseidon", status: "Held by Nia", autority: 5},
    {name: "Gaya's apple", divinity: "Gaya", power: "Create a circle (20m radius). Inside the cicle every wound is instantly heal and it's impossible to died.", slug: "gayas-apple", status: "Held by Odin", autority: 5},
    {name: "Gungnir", divinity: "Odin", power: "The spear never miss it's target and always return to it's bearer.", slug: "gungnir", status: "Held by Odin", autority: 6},
    {name: "Balmung", divinity: "Siegfried", power: "The sword can cut through and destroy anything.", slug: "balmung", status: "Held by Odin", autority: 6},
    {name: "Key of the primordial sea", divinity: "Tiamat", power: "Create an impenetrable temple of water. Only the bearer can decide who can enter. It heal the bearer and his allies.", slug: "key-of-the-primordial-sea", status: "Held by Odin", autority: 7},
    {name: "Enuma Elish", divinity: "Marduk", power: "A spear capable to fire a beam of pure destruction capable of tearing space and time.", slug: "enuma-elish", status: "Held by Odin", autority: 7},
    {name: "The Eye of Horus", divinity: "Horus", power: "Allow to see find anything.", slug: "the-eye-of-horus", status: "Held by Odin", autority: 6},
    {name: "The Gem of Hermes", divinity: "Hermes", power: "Allow to travel anywhere.", slug: "the-gem-of-hermes", status: "Held by Odin", autority: 3},
    {name: "The sword of Amaterasu", divinity: "Amaterasu", power: "The sword can cut through anything and can create a blinding light. It allow it's user to becaume ligth and use powerfull ligth based attack.", slug: "the-sword-of-amaterasu", status: "Held by Odin", autority: 5},
    {name: "The cristal of Tartarus", divinity: "hades", power: "Allow to create a portal to Tartarus.", slug: "the-cristal-of-tartarus", status: "Held by Odin", autority: 5},
    {name: "Zeus's thunder", divinity: "Zeus", power: "Allow to control thunder and lightning.", slug: "zeus-thunder", status: "Held by Odin", autority: 6},
    {name: "Isis's wings", divinity: "Isis", power: "Allow to fly, manipulate wind and heal.", slug: "isis-wings", status: "Held by the dwarves king", autority: 5},
    {name: "The Behemoth's horn", divinity: "Behemoth", power: "A spear forged with the horn of the Behemoth. It can create a shockwave capable of destroying anything, the user can manipulate earth and magma.", slug: "the-behemoths-horn", status: "Held by Cole", autority: 3},
    {name: "Divine Axe Rita", divinity: "Rita", power: "An axe capable of absorbing heat. I great it's bearer immense power that increase as the sun rise. The user can also create small sun.", slug: "divine-axe-rita", status: "Held by Escanor", autority: 3},
    {name: "The eye of Horus", divinity: "Horus", power: "Allow to see the future.", slug: "the-eye-of-horus", status: "Held by Odin", autority: 6},
    {name: "The sword of Mars", divinity: "Mars", power: "Inflict wound that can never be heal.", slug: "the-sword-of-mars", status: "Held by Gengis", autority: 4},
    {name: "The armor of Baldr", divinity: "Baldr", power: "Once put, only the bearer can remove it. Make it's bearer invulnerable to everything expete one thing.", slug: "the-armor-of-baldr", status: "Held by Bjorn", autority: 5},
    {name: "Susanoo's sword", divinity: "Susanoo", power: "The sword allow it's owner to use thunder based attack, create a thunder shield to protect himself and to fly.", slug: "susanoo-sword", status: "Held by first spinjitzu master", autority: 5},
    {name: "The Staff of Anubis", divinity: "Anubis", power: "Allow to control the dead, travel to anywhere, communicate with the dead and guide the soul of the dead.", slug: "the-staff-of-anubis", status: "Held by Anubis", autority: 6},
    {name: "Atlas masse", divinity: "Atlas", power: "Indestrutible masse that grant it's user incredible strenght.", slug: "atlas-masse", status: "Held by Jay", autority: 3},
    {name: "Souls blade", divinity: "Unknown", power: "The sword can absorb the soul of it's victim. The user can use the soul to increase his power.", slug: "souls-blade", status: "Held by White", autority: 8},
    {name: "Appolo's bow", divinity: "Appolo", power: "The bow can create arrow of light that can pierce anything.", slug: "appolos-bow", status: "Held by Tormak", autority: 4},
    {name: "The Sanjiegun of Shiva", divinity: "Shiva", power: "A three part nunchaku granting it's user small power of creation and detruction.", slug: "sanjiegun", status: "Held by Morrow", autority: 6},
    {name: "Ifrit's bane", divinity: "Ifrit", power: "Absord and convert fire into mana. Ignite and cut throughmost things", slug: "ifrit-s-bane", status: "held by Kaelgrym", autority: 4},
    {name: "Chain's of Apophis", divinity: "Apophis", power: "Absord damage, bind and drain hp/power from people", slug: "chain-s-of-apophis", status: "destroid", autority: 6},
    {name: "Masse of Hephaistos", divinity: "Hephaistos", power: "Dense masse of fire that smash ennemi like nail on an enclume", slug: "masse-of-hephaistos", status: "held by Alicia", autority: 5},
    {name: "Sun wukong's Staff", divinity: "Ifrit", power: "Divine staff capable of changing size at the user’s will", slug: "sun-wukong-s-staff", status: "held by Sun wukong", autority: 6},
    {name: "Celestial tower", divinity: "????", power: "Dimensional prison", slug: "celestial-tower", status: "held by Susano", autority: 4},
    {name: "Vasavi Shakti", divinity: "Indra/Karna", power: "Lance of ligth capable of destroying one thing be it an ant or a god", slug: "vasavi-shakti", status: "held by Odin (temp Ninja)", autority: 7},
    {name: "Heart of Wojira", divinity: "Wojira", power: "Grants full control over sea currents and tropical storms.", slug: "heart-of-wujira", status: "held by Island tribe", autority: 2},
    {name: "Yggdrasil's coat", divinity: "Alberon", power: "Passively heals the wearer as long as he is in direct contact with soil or vegetation.", slug: "yggdrasil-s-coat", status: "held by Alberon", autority: 6},
    {name: "Shard of the Aurora", divinity: "????", power: "????", slug: "shard-of-the-aurora", status: "????", autority: 8},
    {name: "Tambours de Kamowakeikazuchi", divinity: "Raijin", power: "Each strike of the bearer charge the drum, at three stakc next atk make a thunder explosions. The drum can also be activate to summon a storms.", slug: "tambours-de-kamowakeikazuchi", status: "held by Vayl-Soran", autority: 6},
];


const capacitis = [
    {type: "Technique", name: "Vorpal slash", element: ["—"], weapon: "Sword", target: ["mono"], desc: "Powerfull estoc with the sword healing it's user.", cat: ["offence", "sustain"], resource: "4T", style: "Aincrad style", dice: "1d12+12, 100%heal"},
    {type: "Technique", name: "Reaver", element: ["—"], weapon: "Cleaver", target: ["aoe"], desc: "Small dash into close range, cleave atk with chance to inflict bleed.", cat: ["offence", "mouvement", "status"], resource: "3T", style: "Aincrad style", dice: "1d8+4, 1d2 bleed"},
    {type: "Technique", name: "Farant fullmoon", element: ["—"], weapon: "Cleaver", target: ["aoe"], desc: "Four qwick slash with the weapon", cat: ["offence"], resource: "3T", style: "Aincrad style", dice: "4d6+8"},
    {type: "Technique", name: "Raging chopper", element: ["—"], weapon: "Cleaver", target: ["cone", "mono"], desc: "Two cleaving cut followed by a vertical slash", cat: ["offence"], resource: "3T", style: "Aincrad style", dice: "2d8+4"},
    {type: "Technique", name: "Sonic leap", element: ["—"], weapon: "Sword", target: ["mono"], desc: "Dash toward a target followed by a strong cut", cat: ["offence", "mouvement"], resource: "2T", style: "Aincrad style", dice: "1d8+2"},
    {type: "Technique", name: "Howling Octave", element: ["Fire"], weapon: "Cleaver", target: ["aoe"], desc: "A 8 hit combo with the final hit behind umbued in fire. burn.", cat: ["offence", "element", "ultimate", "status"], resource: "6T", style: "Kaelgrym style", dice: "7d6+14+1d12+4, burn"},
    {type: "Technique", name: "Deadly Sins", element: ["—"], weapon: "Sword", target: ["mono"], desc: "A seven hit combo followed by a backward dash.", cat: ["offence", "mouvement"], resource: "4T", style: "Aincrad style", dice: "7d6+14"},
    {type: "Technique", name: "Legion Destroyer", element: ["—"], weapon: "Sword", target: ["cone", "mono"], desc: "Six cleaving slash followed by a repositioning dash to unleash a powerfull cut", cat: ["offence", "mouvement", "ultimate", "status"], resource: "6T", style: "Aincrad style", dice: "6d6+12+1d12+6, 1d2 bleed"},
    {type: "Technique", name: "Sonic Charge", element: ["—"], weapon: "Spear", target: ["mono"], desc: "A dash followed by an estoc.", cat: ["offence", "mouvement"], resource: "2T", style: "Aincrad style", dice: "1d6+4"},
    {type: "Technique", name: "Hellical Twice", element: ["—"], weapon: "Spear", target: ["aoe"], desc: "Rotate the lance around the user, deviating projectile and knowking back ennemie", cat: ["block", "react", "cc"], resource: "2T", style: "Aincrad style", dice: ""},
    {type: "Technique", name: "Imperial Southern Cross", element: ["—"], weapon: "Spear", target: ["mono"], desc: "Five rapid estoc followed by a jump and powerfull descending thrust.", cat: ["offence", "mouvement", "ultimate"], resource: "3T", style: "Aincrad style", dice: "5d6+10+1d12+6"},
    {type: "Technique", name: "Dimension Stampede", element: ["—"], weapon: "Spear", target: ["cone", "mono"], desc: "Four horizontal slash followed by a strong estoc", cat: ["offence"], resource: "3T", style: "Aincrad style", dice: "4d6+8+1d12+4"},
    {type: "Technique", name: "Avalanche", element: ["—"], weapon: "Two hand sword", target: ["mono"], desc: "A powerfull top to down slash", cat: ["offence"], resource: "3T", style: "Aincrad style", dice: "1d12+8"},
    {type: "Technique", name: "Lightning", element: ["—"], weapon: "Two hand sword", target: ["mono"], desc: "Four strike following the target", cat: ["offence", "sure hit"], resource: "4T", style: "Aincrad style", dice: "4d6+8"},
    {type: "Technique", name: "Blast", element: ["—"], weapon: "Two hand sword", target: ["mono"], desc: "A powerfull strike with a delayed shock wave", cat: ["offence"], resource: "2T", style: "Aincrad style", dice: "1d8+4+1d12"},
    {type: "Technique", name: "Flashing Penetrater", element: ["—"], weapon: "Rapier", target: ["mono"], desc: "A powerfull dash followed by a storm of strike each mean to kill", cat: ["offence", "ArPen", "mouvement"], resource: "3T", style: "Aincrad style", dice: "9d6+9"},
    {type: "Technique", name: "Twilight Resurrection", element: ["—"], weapon: "Rapier", target: ["mono"], desc: "A high it combo design to overhelm the target", cat: ["offence", "ultimate"], resource: "6T", style: "Aincrad style", dice: "35d6+35"},
    {type: "Technique", name: "Valkyrie Knights", element: ["—"], weapon: "Rapier", target: ["mono"], desc: "Nine vital thrust", cat: ["offence", "ArPen"], resource: "2T", style: "Aincrad style", dice: "9d6+12"},
    {type: "Technique", name: "Spica Caliber", element: ["—"], weapon: "Rapier", target: ["cone"], desc: "3 qwick slash", cat: ["offence", "ArPen"], resource: "2T", style: "Aincrad style", dice: "3d6+3"},
    {type: "Technique", name: "Megaton Swing", element: ["—"], weapon: "Masse", target: ["mono"], desc: "a strong swing that push bakc the target", cat: ["offence", "cc"], resource: "3T", style: "Aincrad style", dice: "1d12+4"},
    {type: "Technique", name: "Colossus Crusher", element: ["—"], weapon: "Masse", target: ["aoe", "mono"], desc: "3 qwick slash", cat: ["offence", "cc"], resource: "5T", style: "Aincrad style", dice: "3d6+3"},
    {type: "Technique", name: "Speedy Hammer", element: ["—"], weapon: "Masse", target: ["mono"], desc: "3 rapid heavy hit that may stun", cat: ["offence", "status"], resource: "3T", style: "Aincrad style", dice: "3d8+12, 1d2 stun"},
    {type: "Technique", name: "Grand Destruct", element: ["—"], weapon: "Two hand Axe", target: ["aoe"], desc: "A powerfull strike capable of grounding ennemie", cat: ["offence", "cc"], resource: "2T", style: "Aincrad style", dice: "1d12+6, 1d2 grounded"},
    {type: "Technique", name: "Ultimate Breaker", element: ["—"], weapon: "Two hand Axe", target: ["mono"], desc: "3 strong swing made to break guard", cat: ["offence", "guard break"], resource: "3T", style: "Aincrad style", dice: "3d8+18"},
    {type: "Technique", name: "Explode Catapult", element: ["—"], weapon: "Two hand Axe", target: ["mono"], desc: "Jump on the target before inflicting two rapid strike", cat: ["offence", "mouvement", "status"], resource: "3T", style: "Aincrad style", dice: "2d8+12, 1d2 bleed"},
    {type: "Technique", name: "Armor Pierce", element: ["—"], weapon: "Dague", target: ["mono"], desc: "A stab with the dague", cat: ["offence", "ArPen", "status"], resource: "1T", style: "Aincrad style", dice: "1d6+2, 1d2 bleed"},
    {type: "Technique", name: "Rapid Bite", element: ["—"], weapon: "Dague", target: ["mono"], desc: "A double stab", cat: ["offence", "ArPen"], resource: "2T", style: "Aincrad style", dice: "2d6+4"},
    {type: "Technique", name: "Starlight Splash", element: ["—"], weapon: "Dague", target: ["mono"], desc: "8 thrust target to vital area", cat: ["offence", "status", "ultimate"], resource: "3T", style: "Aincrad style", dice: "8d6+16, bleed"},
    {type: "Technique", name: "Flame of the Dead", element: ["Fire"], weapon: "Two hand sword", target: ["mono"], desc: "Ethereal flames that burn the soul", cat: ["offence"], resource: "10A", style: "White's Style", dice: "1d8+3"},
    {type: "Technique", name: "Phantom Sword of the Dead", element: ["—"], weapon: "Two hand sword", target: ["mono"], desc: "A ghostly strike that can instill fear", cat: ["offence", "status"], resource: "15A", style: "White's Style", dice: "2d6+4, 1d2 fear"},
    {type: "Technique", name: "Rise of the Dead", element: ["—"], weapon: "Two hand sword", target: ["mono"], desc: "Powerful strike from the abyss", cat: ["offence", "sure hit"], resource: "25A", style: "White's Style", dice: "3d6+9"},
    {type: "Technique", name: "Wake of the Dead", element: ["—"], weapon: "Two hand sword", target: ["aoe"], desc: "A shockwave of souls", cat: ["offence"], resource: "50S", style: "White's Style", dice: "3d8+4"},
    {type: "Technique", name: "Seven Blood Spirit Blade", element: ["—"], weapon: "Two hand sword", target: ["mono"], desc: "Seven strikes combined with spiritual power", cat: ["offence", "ultimate"], resource: "100A", style: "White's Style", dice: "1d8+8"},
    {type: "Technique", name: "Sword of Purple Storm", element: ["Thunder"], weapon: "Two hand sword", target: ["self"], desc: "Instant defense that reduces damage massively (10A/dam)", cat: ["block", "react"], resource: "10A", style: "White's Style", dice: "—"},
    {type: "Technique", name: "Diverging Deathly Sword of Heavenly Spirit", element: ["—"], weapon: "Two hand sword", target: ["mono"], desc: "An overwhelming strike capable of slaying gods", cat: ["adv", "guard breaker", "ultimate"], resource: "1000A", style: "White's Style", dice: "10d12+20"},
    {type: "Sort", name: "Fire Tornado", element: ["Fire", "Wind"], weapon: "—", target: ["aoe"], desc: "Creates a vortex of fire.", cat: ["offence"], resource: "1S", style: "—", dice: "2d12"},
    {type: "Sort", name: "Runik Precast", element: ["Arcane"], weapon: "—", target: ["self"], desc: "Empowers the next spell with ancient runes", cat: ["buff"], resource: "1S", style: "Runic", dice: "+2d12 next spell"},
    {type: "Sort", name: "Water Dragon", element: ["Water"], weapon: "—", target: ["mono"], desc: "Creates a water dragon that bite down an ennemie before implosing", cat: ["offence"], resource: "1S", style: "—", dice: "2d12+1d8"},
    {type: "Sort", name: "Arcane Canal", element: ["Arcane"], weapon: "—", target: ["aoe"], desc: "Restores 4 spell slots to all allies except caster", cat: ["utility"], resource: "1S", style: "—", dice: "—"},
    {type: "Sort", name: "Heat Wave", element: ["Fire"], weapon: "—", target: ["aoe"], desc: "A massive wave of scorching heat", cat: ["offence"], resource: "1S", style: "—", dice: "6*1d6"},
    {type: "Sort", name: "Black Hole", element: ["Shadow"], weapon: "—", target: ["aoe"], desc: "Sucks everything into the shadow void", cat: ["cc", "react", "ultimate"], resource: "1S", style: "Duskbane Style", dice: "—"},
    {type: "Sort", name: "Earth qwake", element: ["Earth"], weapon: "—", target: ["aoe"], desc: "Send tremor in the ground", cat: ["offence", "cc"], resource: "1S", style: "—", dice: "2d8+5, 1d2 dis"},
    {type: "Sort", name: "Shadow Dagger", element: ["Shadow"], weapon: "—", target: ["mono"], desc: "Deals damage based on missing HP", cat: ["offence"], resource: "1S", style: "Duskbaddne Style", dice: "1d4 + 50% missing HP"},
    {type: "Technique", name: "Force Lightning", element: ["Thunder"], weapon: "—", target: ["mono"], desc: "Dark side energy. Massive damage against machines", cat: ["offence"], resource: "3T", style: "Sith", dice: "1d12+6 (+2d12 Mecha)"},
    {type: "Sort", name: "Lightning Shield", element: ["Thunder"], weapon: "—", target: ["mono"], desc: "Generate a shield of thunder, block an attack and purify debuffs", cat: ["block", "purify", "react"], resource: "1S", style: "—", dice: "—"},
    {type: "Sort", name: "Mono Energie Beam", element: ["Energy"], weapon: "—", target: ["mono"], desc: "A beam of pure energy", cat: ["offence"], resource: "1S", style: "—", dice: "1d12+1d8+4"},
    {type: "Sort", name: "Ice Coffin", element: ["Ice"], weapon: "—", target: ["mono"], desc: "Trap the target in ice, can freeze", cat: ["offence", "cc"], resource: "1S", style: "—", dice: "1d10+8"},
    {type: "Sort", name: "Earth Spike", element: ["Earth"], weapon: "—", target: ["cone"], desc: "Spikes emerge from the ground", cat: ["offence"], resource: "1S", style: "—", dice: "1d20+1d6+6"},
    {type: "Sort", name: "Golden Beam", element: ["Energy"], weapon: "—", target: ["mono"], desc: "The ultimate power of the First Spinjitzu Master", cat: ["offence", "ultimate"], resource: "1S", style: "Susano Style", dice: "2d20+20"},
    {type: "Technique", name: "Spinzutsu", element: ["—"], weapon: "—", target: ["aoe"], desc: "Classic martial art technique of Ninjago", cat: ["offence"], resource: "1T", style: "Susano Style", dice: "1d8+2"},
    {type: "Technique", name: "Object Spinzutsu", element: ["—"], weapon: "—", target: ["mono"], desc: "Arin's unique spinjitzu using objects", cat: ["offence"], resource: "1T", style: "Arin Style", dice: "1d12"},
    {type: "Sort", name: "Gravity Up", element: ["Gravity"], weapon: "—", target: ["mono"], desc: "Increases gravity to give disadvantage to the target", cat: ["cc"], resource: "1S", style: "—", dice: "—"},
    {type: "Sort", name: "Fire Spear", element: ["Fire"], weapon: "—", target: ["mono", "aoe"], desc: "Throws a fiery spear dealing mono damage plus area splash", cat: ["offence"], resource: "1S", style: "—", dice: "1d20 + 1d12 aoe"},
    {type: "Sort", name: "Blink", element: ["—"], weapon: "—", target: ["self"], desc: "Instant teleportation", cat: ["mouvement", "react"], resource: "1S", style: "—", dice: "—"},
    {type: "Sort", name: "Energy Beam", element: ["Energy"], weapon: "—", target: ["mono"], desc: "Focused energy blast", cat: ["offence"], resource: "1S", style: "—", dice: "1d10+1d8"},
    {type: "Sort", name: "Chain Thunder", element: ["Thunder"], weapon: "—", target: ["aoe"], desc: "Lightning that jumps between targets with paralysis chance", cat: ["offence", "status"], resource: "1S", style: "—", dice: "2d8+4 (1d2 para)"},
    {type: "Sort", name: "Fire Ball", element: ["Fire"], weapon: "—", target: ["aoe"], desc: "Explosive fire orb", cat: ["offence"], resource: "1S", style: "—", dice: "1d12+6"},
    {type: "Sort", name: "Fire Shield", element: ["Fire"], weapon: "—", target: ["self"], desc: "Instant block using flames", cat: ["block", "react"], resource: "1S", style: "—", dice: "—"},
    {type: "Sort", name: "Fire Breath (Dragon)", element: ["Fire"], weapon: "—", target: ["cone"], desc: "Massive fire breath in dragon form", cat: ["offence"], resource: "1S", style: "Dragon style", dice: "2d12+6"},
    {type: "Sort", name: "Ice Arrow", element: ["Ice"], weapon: "—", target: ["mono"], desc: "Ice projectile with advantage", cat: ["offence", "adv"], resource: "1S", style: "—", dice: "1d10+4"},
    {type: "Sort", name: "Ice Cone", element: ["Ice"], weapon: "—", target: ["aoe"], desc: "Freezing blast in a cone", cat: ["offence"], resource: "1S", style: "—", dice: "1d12+4"},
    {type: "Sort", name: "Ice Breath (Dragon)", element: ["Ice"], weapon: "—", target: ["cone"], desc: "Freezing dragon breath", cat: ["offence"], resource: "1S", style: "Dragon style", dice: "2d12+6"},
    {type: "Sort", name: "Lightning Chain", element: ["Thunder"], weapon: "—", target: ["aoe"], desc: "Electric surge hitting multiple foes", cat: ["offence"], resource: "1S", style: "—", dice: "1d12+2"},
    {type: "Sort", name: "Thunder", element: ["Thunder"], weapon: "—", target: ["mono"], desc: "Powerful single bolt of thunder", cat: ["offence"], resource: "1S", style: "—", dice: "1d20"},
    {type: "Sort", name: "Sea Rebound", element: ["Water"], weapon: "—", target: ["aoe"], desc: "Chain effect that heals allies or damages enemies", cat: ["offence", "sustain"], resource: "1S", style: "—", dice: "1d12"},
    {type: "Sort", name: "Sea Bubble", element: ["Water"], weapon: "—", target: ["mono"], desc: "Instant block and health regeneration", cat: ["block", "sustain", "instant"], resource: "1S", style: "—", dice: "1d6+6"},
    {type: "Sort", name: "Benediction of the Moon", element: ["Water"], weapon: "—", target: ["mono"], desc: "Removes debuffs and grants immunity for 2 turns", cat: ["status", "buff"], resource: "1S", style: "—", dice: "—"},
    {type: "Sort", name: "Water Shield", element: ["Water"], weapon: "—", target: ["self"], desc: "Instant water block", cat: ["block", "instant"], resource: "1S", style: "—", dice: "—"},
    {type: "Technique", name: "Volcana", element: ["Fire"], weapon: "—", target: ["aoe"], desc: "Massive volcanic eruption, hard to hit but devastating", cat: ["offence", "ultimate"], resource: "3T", style: "—", dice: " 1d2 chance to do 2d20+1d12+1d8+6"},
    {type: "Sort", name: "Convert", element: ["Termal"], weapon: "—", target: ["aoe"], desc: "Freezes water or evaporates it", cat: ["utility"], resource: "1S", style: "—", dice: "—"},
    {type: "Sort", name: "Heat Projectile", element: ["Termal"], weapon: "—", target: ["mono"], desc: "Launches fire or ice projectiles", cat: ["offence"], resource: "1S", style: "—", dice: "2d8+2"},
    {type: "Sort", name: "Fire Rush", element: ["Fire"], weapon: "—", target: ["mono"], desc: "Dash towards a target, triggers opportunity attacks", cat: ["mouvement", "offence"], resource: "1S", style: "—", dice: "—"},
    {type: "Techno-spell", name: "Final Brasero", element: ["Fire"], weapon: "Cleaver", target: ["mono"], desc: "Release the entire magic power of the user in one single powerfull slash", cat: ["offence", "status", "ultimate"], resource: "5T", style: "—", dice: "Xd20+10, burn"},
    {type: "Sort", name: "Runik Water Shield", element: ["Water", "Arcane"], weapon: "—", target: ["self"], desc: "Instant block, large heal and purge", cat: ["block", "sustain", "purify", "instant"], resource: "1S", style: "Runic", dice: "1d20 heal"},
    {type: "Sort", name: "Runik Sea Dragon", element: ["Water", "Arcane"], weapon: "—", target: ["mono"], desc: "Summons a massive runic water dragon", cat: ["offence"], resource: "1S", style: "Runic", dice: "1d20+1d12+8"},
    {type: "Sort", name: "Runik Sea Bound", element: ["Water", "Arcane"], weapon: "—", target: ["mono"], desc: "Stuns and roots targets if field is wet", cat: ["status", "cc"], resource: "1S", style: "Runic", dice: "1d2 chance stun/root"},
    {type: "Technique", name: "Bunshin", element: ["—"], weapon: "—", target: ["self"], desc: "Instant dodge or half damage from AOE", cat: ["mouvement", "block", "react"], resource: "3ki", style: "Sakura blossom sect", dice: "—"},
    {type: "Technique", name: "Eternal Bloom", element: ["—"], weapon: "—", target: ["mono"], desc: "Protective shield of petals", cat: ["block", "react"], resource: "5ki", style: "Sakura blossom sect", dice: "—"},
    {type: "Technique", name: "Field of Corruption", element: ["Poison"], weapon: "—", target: ["aoe"], desc: "Cursed field inflicting multiple debuffs", cat: ["status", "cc"], resource: "10ki", style: "Sakura blossom sect", dice: "para/poison/burn/dis"},
    {type: "Technique", name: "Field of Flower", element: ["—"], weapon: "—", target: ["aoe"], desc: "Healing field that removes debuffs", cat: ["sustain", "purify"], resource: "5ki", style: "Sakura blossom sect", dice: "10hp/t for 3 turn"},
    {type: "Technique", name: "Jade Lightning", element: ["Thunder"], weapon: "—", target: ["mono"], desc: "Fast green lightning strike", cat: ["offence"], resource: "3ki", style: "Sakura blossom sect", dice: "1d6+6"},
    {type: "Technique", name: "Banquet", element: ["—"], weapon: "—", target: ["self"], desc: "Rests to recover HP and gain advantage", cat: ["sustain", "buff"], resource: "5ki", style: "—", dice: "1d10+10hp"},
    {type: "Technique", name: "Spirit of the Wild Boar", element: ["—"], weapon: "—", target: ["aoe"], desc: "Defensive stance that taunts and reduces damage", cat: ["deffense", "cc"], resource: "10ki", style: "Yokai", dice: "-10 dam received"},
    {type: "Technique", name: "Breath of Fire", element: ["Fire"], weapon: "—", target: ["cone"], desc: "Fiery breath using Ki", cat: ["offence"], resource: "5ki", style: "Yokai", dice: "1d12+6"},
    {type: "Sort", name: "Greater Teleportation", element: ["Arcane"], weapon: "—", target: ["aoe"], desc: "Instant teleportation of all allies", cat: ["mouvement", "react"], resource: "1S", style: "—", dice: "—"},
    {type: "Sort", name: "Thunder Storm", element: ["Thunder"], weapon: "—", target: ["aoe"], desc: "Massive lightning storm", cat: ["offence"], resource: "1S", style: "—", dice: "1d20+1d8+4"},
    {type: "Sort", name: "Recursing Shield", element: ["Arcane"], weapon: "—", target: ["self"], desc: "Instant multi-layered shield", cat: ["block", "instant"], resource: "1S", style: "—", dice: "1d4*20 shield"},
    {type: "Sort", name: "Arcane Missile", element: ["Arcane"], weapon: "—", target: ["mono"], desc: "Accurate arcane bolts with advantage", cat: ["offence", "adv"], resource: "1S", style: "—", dice: "1d12+1d10+10"},
    {type: "Technique", name: "Hunter Instinct", element: ["—"], weapon: "—", target: ["self"], desc: "Passive accuracy, guaranteed to hit", cat: ["buff", "instant", "sure hit"], resource: "3T", style: "Wolf Clan", dice: "—"},
    {type: "Technique", name: "Shreder", element: ["—"], weapon: "Claw", target: ["mono"], desc: "Dash and slash with claws", cat: ["offence", "mouvement"], resource: "1T", style: "Wolf Clan", dice: "+2d6"},
    {type: "Technique", name: "Shatterspin", element: ["—"], weapon: "—", target: ["aoe"], desc: "Corruption version of Spinzutsu", cat: ["offence"], resource: "2T", style: "Forbidden five", dice: "1d12"},
    {type: "Sort", name: "Wind Cutter", element: ["Wind"], weapon: "—", target: ["aoe"], desc: "Sharp blade of air", cat: ["offence"], resource: "1S", style: "—", dice: "1d12"},
    {type: "Sort", name: "Wind Tornado", element: ["Wind"], weapon: "—", target: ["aoe"], desc: "Vortex that gives disadvantage", cat: ["offence", "cc"], resource: "1S", style: "—", dice: "1d6 (1d2 dis)"},
    {type: "Sort", name: "Poison Breath", element: ["Poison", "Nightmare"], weapon: "—", target: ["cone"], desc: "Toxic breath from the nightmare realm", cat: ["offence", "status"], resource: "1S", style: "Nightmare", dice: "1d12+8 (1d2 poison)"},
    {type: "Sort", name: "Chain of Damnation Wall", element: ["Nightmare"], weapon: "—", target: ["aoe"], desc: "Creates a physical wall of cursed chains", cat: ["block", "cc"], resource: "1S", style: "Nightmare", dice: "3d20hp wall"},
    {type: "Sort", name: "Shadow Dragon", element: ["Shadow", "Nightmare"], weapon: "—", target: ["mono"], desc: "Summons a dragon of shadows", cat: ["offence"], resource: "1S", style: "Nightmare", dice: "2d12+1d8+1d6+4"},
    {type: "Technique", name: "Scream of the Banshee", element: ["Psy", "Nightmare"], weapon: "—", target: ["cone"], desc: "Terrifying scream that stuns", cat: ["offence", "status"], resource: "1T", style: "Nightmare", dice: "2d12+8 (1d2 stun)"},
    {type: "Sort", name: "Gravity Down", element: ["Gravity"], weapon: "—", target: ["mono"], desc: "Increases target's weight to give attackers advantage", cat: ["status"], resource: "1S", style: "—", dice: "adv for attacker"},
    {type: "Sort", name: "Fiesta", element: ["Sound"], weapon: "—", target: ["aoe"], desc: "Forces targets to dance, stunning them", cat: ["status", "cc"], resource: "1S", style: "Bard", dice: "1d2 dance stun"},
    {type: "Technique", name: "Fente de Quartz", element: ["—"], weapon: "Two hand sword", target: ["mono"], desc: "Une estoc lourde où la lame s'allonge temporairement par une pointe de cristal.", cat: ["offence", "ArPen"], resource: "2T", style: "Résonance de Cristal", dice: "1d12+8"},
    {type: "Technique", name: "Résonance Cristalline", element: ["—"], weapon: "Two hand sword", target: ["aoe"], desc: "Le chevalier frappe son épée contre son armure, créant une onde de choc qui repousse les ennemis proches.", cat: ["cc", "deffense"], resource: "3T", style: "Résonance de Cristal", dice: "1d8+4 (Knockback)"},
    {type: "Technique", name: "Éclat de Rétribution", element: ["—"], weapon: "Two hand sword", target: ["mono"], desc: "Après un blocage réussi, une partie de l'armure se brise en éclats pour infliger des dégâts à l'assaillant.", cat: ["react", "offence"], resource: "2T", style: "Résonance de Cristal", dice: "2d6+4"},
    {type: "Technique", name: "Garde Prismatique", element: ["—"], weapon: "Two hand sword", target: ["self"], desc: "L'épée est tenue verticalement, créant un prisme de lumière qui réduit les dégâts magiques.", cat: ["block", "status"], resource: "3T", style: "Résonance de Cristal", dice: "-5 flat mag dam (3t)"},
    {type: "Technique", name: "Tranchant de Vitrail", element: ["—"], weapon: "Two hand sword", target: ["aoe"], desc: "Un large balayage circulaire laissant derrière lui une traînée de poussière de cristal infligeant Saignement.", cat: ["offence", "status"], resource: "3T", style: "Résonance de Cristal", dice: "2d8+2 (Bleed 1d2)"},
    {type: "Technique", name: "Impact de Géode", element: ["—"], weapon: "Two hand sword", target: ["mono"], desc: "Un saut suivi d'un coup descendant massif capable de briser les défenses.", cat: ["offence", "guard break"], resource: "4T", style: "Résonance de Cristal", dice: "3d10+6"},
];


const EFFECTS = [
    { name: "Burn", dice: "1d4", type: "fire", notes: "fire dam" },
    { name: "Toxic", dice: "1d4", type: "poison", notes: "poison dam" },
    { name: "Para", dice: "1d2", type: "—", notes: "unable to move / act" },
    { name: "Gel", dice: "1d2", type: "ice", notes: "unable to move / act" },
    { name: "Bleed", dice: "1d4", type: "physical", notes: "loose hp each move" },
    { name: "Silence", dice: "—", type: "holy", notes: "can't cast spell" },
    { name: "Root", dice: "—", type: "—", notes: "can't move from position or use movement ability" },
    { name: "Stun", dice: "—", type: "—", notes: "unable to move / act" },
    { name: "Blind", dice: "—", type: "—", notes: "triple disadv" },
    { name: "Cocoon", dice: "—", type: "—", notes: "unable to move / act" },
    { name: "Sure hit", dice: "—", type: "—", notes: "can't be dodge" },
    { name: "Guard breaker", dice: "—", type: "—", notes: "can't be blocked" },
    { name: "ArPen", dice: "—", type: "—", notes: "Ignore armor" },
    { name: "Fear", dice: "—", type: "psy", notes: "unable to move / act, vulnerabe to psy dam"},
    { name: "Grounded", dice: "—", type: "—", notes: "unable to fly"},
    

];

const titles = {
  "Titan slayer": { effect: "+1d12 vs max hp>self", rarity: 4 },
  "Professional diver": { effect: "+2 const roll", rarity: 1 },
  "Relentless warrior": { effect: "+/-1d10+2 dam/resis roll per ally k.o.", rarity: 4 },
  "Savaged child": { effect: "+2 const & imun toxic", rarity: 2 },
  "Roubelar": { effect: "+3 lockpiking/defuse trap", rarity: 2 },
  "Erudie": { effect: "adv spell roll", rarity: 4 },
  "Sword master": { effect: "adv sword roll", rarity: 3 },
  "Master of the ninja's art": { effect: "+2 const/percep/decep/atk/def & +1d6 dam", rarity: 5 },
  "Jack of all trade": { effect: "+1 all roll", rarity: 5 },
  "Traitor": { effect: "+1d6+2 dam if atk in the back", rarity: 3 },
  "Survivalist": { effect: "+2 const/percep/decep", rarity: 4 },
  "Blood of fire": { effect: "cauterise 1d6+2 on dam & imun toxic/freeze & -1d4+2 ice dam", rarity: 5 },
  "Ranger": { effect: "+3 lockpiking/percep/defuse/set trap", rarity: 3 },
  "Blacksmith": { effect: "+1 const & 1d4 physical dam", rarity: 2 },
  "Archmage": { effect: "+3 spell roll & +3 spell slot", rarity: 5 },
  "Sword saint": { effect: "+3 weapon roll & 1d8+2 dam", rarity: 5 },
  "Climber": { effect: "+2 climbing roll", rarity: 1 },
  "Basic training": { effect: "+1 weapon roll", rarity: 1 },
  "Beast hunter": { effect: "+1d6+4 dam vs beast/monster", rarity: 4 },
  "Tigre hunter": { effect: "+1d6+2 dam vs tigre", rarity: 2 },
  "Pugiliste": { effect: "+1d4+2 barehand dam", rarity: 3 },
  "Sailor": { effect: "+1 boat realated roll", rarity: 1 },
  "Captain": { effect: "+2 boat realated roll", rarity: 2 },
  "Ninja": { effect: "+2 decep roll", rarity: 2 },
  "Dragon slayer": { effect: "+1d8+4 dam vs drag", rarity: 5 },
  "Oni slayer": { effect: "+1d8+4 dam vs oni", rarity: 5 },
  "Alchimiste": { effect: "+2 potion related roll", rarity: 2 },
  "Mechano": { effect: "+1 mechani roll", rarity: 1 },
  "Warden of the wilds": { effect: "+3 perception & +1d6 dam vs beasts", rarity: 4 },
  "Ironbody": { effect: "+3 physical dam roll & +2 def roll", rarity: 4 },
  "Armor breaker": { effect: "+1d4+2 dam vs armored targets", rarity: 3 },
  "Marathon runner": { effect: "+2 endurance roll", rarity: 3 },
  "Beast intimidator": { effect: "+2 decep/intimidation vs beasts", rarity: 3 },
  "Battle tactician": { effect: "+2 to ally atk roll if giving orders", rarity: 3 },
  "Precise shot": { effect: "+1d4+2 dam with ranged", rarity: 3 },
  "Heavy striker": { effect: "+1d4+1 dam with heavy weapons", rarity: 3 },
  "Herbalist": { effect: "+2 plant knowledge roll", rarity: 2 },
  "Quick hands": { effect: "+2 agility roll", rarity: 2 },
  "Trap finder": { effect: "+2 detect trap roll", rarity: 1 },
  "Cook": { effect: "+1 cooking roll", rarity: 1 },
  "Woodcutter": { effect: "+1 woodcutting roll", rarity: 1 },
  "Forager": { effect: "+1 plant gathering roll", rarity: 1 },
  "Scout": { effect: "+1 perception roll", rarity: 1 },
  "Tracker": { effect: "+1 tracking roll", rarity: 1 },
  "Assassin": { effect: "+2 decep roll", rarity: 2 },
  "Sentinel": { effect: "+2 percep roll", rarity: 2 },
  "First Aid": { effect: "+1 basic healing roll", rarity: 1 },
  "Pit Fighter": { effect: "+1d4 unarmed damage", rarity: 2 },
  "Sharp-Eyed": { effect: "+2 precep", rarity: 2 },
  "Close Quarters Expert": { effect: "+1d4+2 damage in melee combat", rarity: 3 },
  "Arrow Dancer": { effect: "+3 defense roll vs ranged attacks", rarity: 3 },
  "Battle Medic": { effect: "+3 healing roll & can heal as bonus action", rarity: 5 },
  "War Banner Carrier": { effect: "+2 to all ally rolls within 10m", rarity: 5 },
  "Opportunist": { effect: "+1d8 damage against stunned or prone enemies", rarity: 4 },
  "Quick Stitcher": { effect: "+1 basic crafting or repair roll", rarity: 1 },
  "Market Haggle": { effect: "+1 persuasion roll", rarity: 1 },
  "Night Watcher": { effect: "+2 perception rolls at night", rarity: 2 },
  "Beast Whisperer": { effect: "+2 animal handling roll & +1d4 vs hostile beasts", rarity: 2 },
  "Counter flow": { effect: "+1d4 damage after a successful parry/dodge", rarity: 3 },
  "Iron Sentinel": { effect: "+3 defense roll when guarding an ally", rarity: 3 },
  "Blood Tracker": { effect: "+3 percep roll & +1d6 damage vs wounded targets", rarity: 3 },
  "Phoenix Heart": { effect: "if below half HP, regain 2d20 HP at the start of turn, once per combat", rarity: 4 },
  "Wyrm’s Blood": { effect: "Immunity to fire & +1d8+4 damage with breath weapon attacks", rarity: 5 },
  "Shadow Emperor": { effect: "+2 stealth, +2 deception, & advantage on ambush/opportunity rolls", rarity: 5 },
  "Avatar of War": { effect: "+3 to all weapon rolls, +1d6 damage, cannot be disarmed", rarity: 5 },
  "Master of the Aincrad style" : { effect: "Allow to use the ultimate skill, also to use any from different weapon type", rarity: 5},
  "Advanced Aincrad style" : { effect: "Also to use any from different weapon type, with restriction", rarity : 3},
  "Aincrad student" : { effect: "Allow to use Aincrad style skills", rarity : 2},
  "Holy knight" : {effect: "+1d6 dam when using a weapon", rarity : 3},
  "Hero of dawn" : {effect: "immun radiant dam, -1d8 dark dam, +1d12 vs evil", rarity : 5},
  "Divine body" : {effect: "+5ki", rarity : 3},
  "mana veines" : {effect: "+3 spell slot", rarity : 3},
  "Brave heart" : {effect: "Immunity to fear", rarity: 2},
  "Heart of the beast" : {effect : "Immunity to fear and toxic, +1 decep", rarity: 3}
};

const weights = { 1: 50, 2: 30, 3: 15, 4: 4, 5: 1 };

const personnageSheet = [
    {
        name: "Susano",
        hp: 70,
        passives: ["First master (+1d8 dam)"],
        forms: [
            {
                name: "Nirvana",
                hpBonus: 60,
                effects: ["Each stone grants 1d6 bonus to element"],
                spells: [
                    { name: "Fire Ball", type: "aoe", dice: "1d10+10" },
                    { name: "Lightning Shield", type: "react block", desc: "Self/Other, purify" },
                    { name: "Mono Energie Beam", type: "mono", dice: "1d12+1d8+6" },
                    { name: "Ice Coffin", type: "mono", dice: "1d12+3", effect: "1d2 freeze" },
                    { name: "Earth Spike", type: "cone", dice: "1d20+1d6+6" },
                    { name: "Golden Beam", type: "mono", dice: "2d20+20", cooldown: "5t" }
                ],
                attack: "Cleaver 2d8+8"
            }
        ],
        abilities: [
            { name: "True Power", type: "transformation", cost: "5t", desc: "Change to Nirvana form" },
            { name: "Spinzutsu", type: "technique", dice: "1d8+6", cooldown: "1t" }
        ],
        attack: "Cleaver 1d8+8",
        spellSlots: 9
    },
    {
        name: "Thormak, The Titan Slayer",
        hp: 70,
        passives: ["Unkillable (1d2 if mortal dam)", "Titan Slayer (+1d12 if foe has more HP)"],
        spells: [
            { name: "Fire Spear", type: "mono + aoe", dice: "1d20 mono + 1d12 aoe" },
            { name: "Blink", type: "instant", desc: "Teleportation" }
        ],
        relics: [
            { name: "Apolo's Bow", charges: "3/3", effects: ["Advantage"], dice: "2d20+10 mono" }
        ],
        attack: "Bite 1d8, Claw 2d6",
        spellSlots: 9
    },
    {
        name: "Sensei Lloyd",
        hp: 65,
        forms: [
            { name: "Oni Lloyd", hpBonus: 5, spellSlotsBonus: 3, atkBonus: "1d10" }
        ],
        abilities: [
            { name: "Oni Form", type: "transformation", limit: "1 time per fight" },
            { name: "Spinzutsu", type: "technique", dice: "1d8 aoe", cooldown: "1t" }
        ],
        spells: [
            { name: "Mono Energie Beam", type: "mono", dice: "1d10+1d8" },
            { name: "Chain Thunder", type: "aoe", dice: "2d8+4", effect: "1d2 para" }
        ],
        attack: "Power Sword 1d8+4",
        spellSlots: 7
    },
    {
        name: "Kay Climber",
        hp: 65,
        passives: ["Armored (+2 saving throw)", "Professional Diver (+2 const air)", "Relentless Warrior (reduce +/-1d10+2 dam per ally KO)"],
        forms: [
            {
                name: "Dragon Form",
                hpBonus: 15,
                effects: ["Fly", "Lose Armored"],
                spells: [
                    { name: "Fire Breath", dice: "2d12+6" }
                ],
                attack: "Fire Cleaver 1d12+1d6+4"
            }
        ],
        spells: [
            { name: "Fire Ball", type: "aoe", dice: "1d12+6" },
            { name: "Fire Shield", type: "instant", desc: "One block" }
        ],
        abilities: [
            { name: "Dragon Form", type: "transformation", limit: "1 per fight", duration: "4t" },
            { name: "Spinzutsu", type: "technique", dice: "1d8 aoe", cooldown: "1t" }
        ],
        attack: "Power Sword 1d10+4",
        spellSlots: 7
    },
    {
        name: "Zane Climber",
        hp: 65,
        passives: ["Armored (+2 saving throw)"],
        forms: [
            {
                name: "Dragon Form",
                hpBonus: 15,
                effects: ["Fly", "Lose Armored"],
                spells: [
                    { name: "Ice Breath", dice: "2d12+6" }
                ],
                attack: "Ice Sword 1d12+1d4, -2 init"
            }
        ],
        spells: [
            { name: "Ice Arrow", type: "mono", dice: "1d10+4", effects: ["Advantage"] },
            { name: "Ice Cone", type: "aoe", dice: "1d12+4" }
        ],
        abilities: [
            { name: "Dragon Form", type: "transformation", limit: "1 per fight", duration: "4t" },
            { name: "Spinzutsu", type: "technique", dice: "1d8 aoe", cooldown: "1t" }
        ],
        attack: "Power Picaxe 2d6+4",
        spellSlots: 6
    },
    {
        name: "Jay Climber",
        hp: 65,
        passives: ["Armored (+2 saving throw)"],
        forms: [
            {
                name: "Dragon Form",
                effects: ["Fly", "Lose Armored", "Regain all spell slots", "Adv save"],
                spells: [
                    { name: "Thunder Breath", dice: "1d12+1d6+2" }
                ],
                attack: "Thunder Rapier mono 1d12+4, adv"
            }
        ],
        spells: [
            { name: "Lightning Chain", type: "aoe", dice: "1d12+2" },
            { name: "Thunder", type: "mono", dice: "1d20" }
        ],
        abilities: [
            { name: "Dragon Form", type: "transformation", limit: "1 per fight", duration: "5t" },
            { name: "Spinzutsu", type: "technique", dice: "1d8 aoe", cooldown: "1t" }
        ],
        attack: "Power Sword 1d8+4",
        spellSlots: 6
    },
    {
        name: "Nya Léviathan",
        hp: 60,
        spells: [
            { name: "Sea Rebound", type: "chain aoe", dice: "1d12 heal or damage" },
            { name: "Sea Bubble", type: "mono", desc: "Insta block, regen 1d6+6" },
            { name: "Bénédiction of the Moon", type: "mono", desc: "Remove debuff, 2t immunity" },
            { name: "Water Shield", type: "instant", desc: "Block" }
        ],
        abilities: [
            { name: "Spinzutsu", type: "technique", dice: "1d8 aoe", cooldown: "1t" }
        ],
        attack: "Spear 1d8+2",
        spellSlots: 8
    },
    {
        name: "Kay Demon",
        hp: 65,
        passives: ["Immun weak magic"],
        spells: [
            { name: "Fire Ball", type: "aoe", dice: "1d12+1d8+2" }
        ],
        abilities: [
            { name: "Volcana", type: "technique", dice: "2d20+1d12+1d8+6", effect: "1d2 miss", cooldown: "3t" },
            { name: "Avida Slash", type: "technique", dice: "1d20+1d10+10", desc: "Unblockable", cooldown: "1t" }
        ],
        attack: "1d12+1d6+2",
        spellSlots: 4
    },
    {
        name: "Pixal",
        hp: 60,
        abilities: [
            { name: "Scaner", desc: "Scan the area" }
        ],
        attack: "Sword 1d6+2"
    },
    {
        name: "Sora",
        hp: 60,
        spells: [
            { name: "Remake", type: "mono/mecha", dice: "1d20+20 heal" }
        ],
        abilities: [
            { name: "Spinzutsu", type: "technique", dice: "1d8 aoe", cooldown: "1t" }
        ],
        attack: "Sword 1d6+2",
        spellSlots: 3
    },
    {
        name: "Arin",
        hp: 60,
        passives: ["Débrouillard (+3 pick lock/disarm traps)"],
        abilities: [
            { name: "Object Spinzutsu", type: "technique", dice: "1d12 mono", cooldown: "1t" }
        ],
        attack: "Sword 1d6+2"
    },
    {
        name: "Wyldfire",
        hp: 65,
        passives: ["Savage Child (less toxic damage, +2 breath)"],
        spells: [
            { name: "Convert", type: "aoe", desc: "Freeze or evaporate water" },
            { name: "Heat Projectile", type: "projectile", dice: "2d8+2 fire or ice" }
        ],
        attack: "Dagger 1d4",
        spellSlots: 3
    },
    {
        name: "Eragon",
        hp: 50,
        passives: ["Know adv on spell"],
        spells: [
            { name: "Fire Tornado", type: "aoe", dice: "2d12 fire/wind", desc: "Removes wet/disadvantage" },
            { name: "Fly", limit: "1 fight" },
            { name: "Runique Precast", desc: "+2d12 next spell" },
            { name: "Shield", dice: "20thp" },
            { name: "Water Dragon", type: "mono", dice: "2d12 + 1d8 aoe", effect: "Add wet" },
            { name: "Ice Coffin", type: "aoe", dice: "1d12 (+2d10 if wet)", effect: "Disadv next saving throw" },
            { name: "Arcane Canal", desc: "Regen 4 spell slots to everyone else" }
        ],
        spellSlots: 20
    },
    {
        name: "Alicia",
        hp: 75,
        passives: [
            "Fly", "Flame of Life (1d6 heal/turn, +10hp, fire immunity)", 
            "Heavy Armor & Shield (+5 def roll)", 
            "Odin's Blessing (Immune to status, +9 slots, +5hp, +5 init/percep)", 
            "Loki's Blessing (Extra death roll 2x)", 
            "Thor's Blessing (Lightning immunity)", 
            "Heimdall's Blessing (+5 init/percep)", 
            "Helga's Disciple (Ice immunity)", 
            "Hero of Dawn (Radiant immunity, -1d8 dark dam, +1d12 vs evil)", 
            "Holy Knight (+1d6 radiant on weapon)"
        ],
        spells: [
            { name: "Heat Wave", type: "aoe", dice: "6*1d6 fire" },
            { name: "Fire Shield", type: "instant", desc: "Block" }
        ],
        abilities: [
            { name: "Nexo Pouvoir: Fire Dragon Breath", type: "cone", dice: "1d12+1d8 fire", cooldown: "3t" },
            { name: "The Hanvil of War", dice: "1d10*(1d4 phy + 1d4 fire)", cooldown: "2t" }
        ],
        relics: [
            { name: "Odin's Warth", type: "aoe", dice: "1d10+10 divine", effect: "1d2 silence for 2t" },
            { name: "Mace of Vulkan", authority: 5, dice: "1d12+8 phy mono + 1d6 fire aoe" }
        ],
        attack: "Mace 1d12+8",
        spellSlots: 14 // Base 5 + Odin's 9
    },
    {
        name: "Ras",
        hp: 80,
        passives: ["Natural Predator (+5 init)", "Hunter Fest (Heal 1d6 each hit)"],
        abilities: [
            { name: "Hunter Instinct", type: "instant", desc: "Sure hit", cooldown: "3t" }
        ],
        attack: "1d8+2"
    },
    {
        name: "General of the Wolf Clan",
        hp: 70,
        forms: [
            { name: "Blood General", hpBonus: 15, effects: ["Blood Arm (+4d4 atk roll)"] }
        ],
        abilities: [
            { name: "Blood Form", duration: "End of combat" },
            { name: "Shreder", desc: "Dash to target + 2d6", cooldown: "1t" }
        ],
        attack: "Claw 2d4"
    },
    {
        name: "Cinder",
        hp: 60,
        forms: [
            { name: "Blood Cinder", effects: ["Smoke Body (adv save)", "+1d6 damage"] }
        ],
        abilities: [
            { name: "Blood Form", duration: "End of combat" },
            { name: "Shatterspin", dice: "1d12", cooldown: "2t" }
        ],
        attack: "Sword 1d6"
    },
    {
        name: "Kaelgrym",
        hp: 65,
        passives: [
            "Survivalist (+2 const/percep/decep)", 
            "Blood of Fire (Cauterise 1d6+2 heal each dam, immune toxic/freeze, -1d4+2 ice dam)", 
            "Beast Slayer (1d6+6 vs monster)", 
            "Kuraokami Rain Coat (-1d8+10 water dam, immune wet)", 
            "Blacksmith (+1 const, 1d4 dam roll)", 
            "Sword Master (+2 atk roll with sword)"
        ],
        spells: [
            { name: "Fire Rush", desc: "Dash to target, triggers op atk" }
        ],
        abilities: [
            { name: "Reaver", type: "aoe", dice: "1d8+4", effect: "1d2 bleed", cooldown: "3t" },
            { name: "Farant Fullmoon", type: "mono", dice: "4d6+8", cooldown: "2t" },
            { name: "Raging Chopper", type: "cone/mono", dice: "2d6+4 / 1d8+4", cooldown: "3t" },
            { name: "Vorpal Slash", type: "mono", dice: "1d12+5", effect: "100% heal", cooldown: "4t" },
            { name: "Final Brasero", type: "mono", effect: "burn", cooldown: "5t" }
        ],
        relics: [
            { name: "Ifrit's Bane (Sleeping)", desc: "Absorb fire to spell slots", dice: "1d12+1d6+4" },
            { name: "Ifrit's Bane (Awake)", dice: "1d12+1d8+1d6+6", effect: "1d2 burn" }
        ],
        spellSlots: 8
    },
    {
        name: "Admiral Jaina",
        hp: 80,
        passives: ["Chasseuse de tigre (+1d8 vs tigre)"],
        spells: [
            { name: "Runik Water Shield", type: "block", desc: "Insta block + 1d20 heal + purge" },
            { name: "Runik Sea Dragon", dice: "1d20+1d12+8" },
            { name: "Runik Sea Bound", desc: "If wet field adv", effect: "1d2 stun, 1d2 root" }
        ],
        relics: [
            { name: "Dominion of the Seven Sea", type: "aoe", dice: "7d12", effects: ["Advantage"] }
        ],
        spellSlots: 12
    },
    {
        name: "Sun",
        hp: 65,
        ki: 12,
        kiRegen: 4,
        abilities: [
            { name: "Bunshin", type: "react", cost: "3ki", desc: "Insta dodge mono, half aoe" },
            { name: "Eternal Bloom", type: "react", cost: "5ki", desc: "Shield" }
        ],
        attack: "Divine Staff 2d8+1d12+6"
    },
    {
        name: "Meï",
        hp: 60,
        ki: 5,
        kiRegen: 3,
        abilities: [
            { name: "Field of Corruption", type: "aoe", cost: "10ki", effect: "1d2 para, 1d2 poison, 1d2 burn, 1d2 dis atk" },
            { name: "Field of Flower", type: "aoe", cost: "5ki", effect: "Remove debuff, heal 10hp/t" },
            { name: "Jade Ligthning", type: "mono", cost: "3ki", dice: "1d6+6" }
        ],
        attack: "Jade Sword 1d6+6"
    },
    {
        name: "Krilin",
        hp: 60,
        ki: 0,
        kiRegen: 1,
        abilities: [
            { name: "Banquet", cost: "5ki", desc: "Rest 5ki, 1d10+10hp, adv next roll" },
            { name: "Spawn Food", cost: "1-5ki" }
        ],
        attack: "Eat 1d4+2"
    },
    {
        name: "Baal",
        hp: 70,
        ki: 6,
        kiRegen: 1,
        passives: ["Yokai Blood (+1d6hp/t)"],
        abilities: [
            { name: "Spirit of the Wild Boar", type: "aoe", cost: "10ki", desc: "-10dam, half-taunt" },
            { name: "Breath of Fire", type: "cone", cost: "5ki", dice: "1d12+6" }
        ],
        attack: "Sword 1d8+4"
    },
    {
        name: "White",
        hp: 250,
        souls: 3736,
        passives: ["Fly", "Sword of Space (atk from anywhere, adv)", "Sous Powered (+5 atk, +4 def, +2 const)"],
        abilities: [
            { name: "Flame of the Dead", type: "mono", dice: "1d8+3", cost: "10s" },
            { name: "Phantom Sword of the Dead", dice: "2d6+4", cost: "15s", effect: "1d2 fear" },
            { name: "Rise of the Dead", type: "mono", dice: "3d6+9", cost: "25s", desc: "Sure hit" },
            { name: "Wake of the Dead", type: "aoe", dice: "3d8+4", cost: "50s" },
            { name: "Seven Blood Spirit Blade", dice: "1d8+8", cost: "100s", duration: "7t" },
            { name: "Sword of Purple Storm", type: "insta block", cost: "10s per 1 dam" },
            { name: "Diverging Deathly Sword of Heavenly Spirit", type: "mono", dice: "10d12+20", cost: "1000s", desc: "Adv, guard breaker" }
        ]
    },
    {
        name: "Kadgar",
        hp: 60,
        passives: [
            "Archmage (+3 magic roll, +3 spell slot)", 
            "Knowledge (adv magic roll)", 
            "Great Staff (+2 magic roll, prevent 3/3 crit fail)", 
            "Runik Mage (+1d12 to all magic)"
        ],
        spells: [
            { name: "Greater Teleportation", type: "react", desc: "Teleport all allies" },
            { name: "Thunder Strom", type: "aoe", dice: "1d20+1d8+4" },
            { name: "Recursing Shield", type: "instant", dice: "1d4*20 shield" },
            { name: "Arcane Missile", type: "mono", dice: "1d12+1d10+10", effect: "Advantage" },
            { name: "Ice Tomb", effect: "1d2 freeze" },
            { name: "Dragon Breath", type: "cone", dice: "1d12+8", desc: "Chosen element" }
        ],
        spellSlots: 33
    },
    {
        name: "Vorrakan Duskbane",
        hp: 65,
        passives: [
            "Shadow Veil (+5 deception, travel in shadows)", 
            "Sismique Sense (+5 perception)", 
            "Traitor (1d8 dam if behind)", 
            "Jack of All Trade (+1 to every roll)"
        ],
        spells: [
            { name: "Black Hole", type: "aoe", desc: "Aspire everything into shadow void" },
            { name: "Shadow Slash", type: "cone" },
            { name: "Earthquake", type: "aoe", dice: "2d8+5", effect: "1d2 dis" },
            { name: "Shadow Gate", desc: "Spit something from shadow void" },
            { name: "Shadow Dagger", dice: "1d4 + 50% missing hp" }
        ],
        abilities: [
            { name: "Force Grab/Pull", dice: "1d6+2", cooldown: "2t" },
            { name: "Force Lightning", dice: "1d12+6 (+2d12 mecha)", cooldown: "3t" },
            { name: "Vorpal Slash", dice: "2d10+10", effect: "100% heal + 5 slots", cooldown: "4t" },
            { name: "Sonic Leap", dice: "1d12+4", cooldown: "2t" },
            { name: "Spinzutsu", dice: "1d8", cooldown: "1t" },
            { name: "Shatterspin", dice: "2d8+2", cooldown: "3t" },
            { name: "Airzutsu", desc: "1t fly", cooldown: "2t" },
            { name: "Dragon Rebel", dice: "2d8+2", cooldown: "3t" }
        ],
        relics: [
            { name: "Chain's of Apophis", authority: 8, desc: "Absorb damage directed toward master" }
        ],
        attack: "Swords 2d8+6",
        spellSlots: 10
    },
    {
        name: "Morrow",
        hp: 65,
        passives: ["Wind Runner (+5 init)", "Fly", "-20 physical dam"],
        spells: [
            { name: "Wind Cuter", dice: "1d12 aoe" },
            { name: "Wind Tornado", dice: "1d6 aoe", effect: "d2 disavantage" }
        ],
        relics: [
            { name: "End of Three World", dice: "3d20+10 aoe" }
        ],
        attack: "3d12+6 damage",
        spellSlots: 5
    },
    {
        name: "Anti-magic Squelette",
        hp: 50,
        passives: ["Magic Resist (-10 magic dam)", "Undead Army (2hp regen)"],
        attack: "Sword 1d6"
    },
    {
        name: "Astrid",
        hp: 95,
        passives: ["Armored (+2 def roll)", "Knight Honor (+1d12 if 1vs1)"],
        spells: [
            { name: "Arc en Slash", type: "mono", dice: "1d10+1d8+14" }
        ],
        attack: "1d8+8",
        spellSlots: 4
    },
    {
        name: "Sylvanas",
        hp: 95,
        passives: ["Ranger (+3 percep, decep)"],
        abilities: [
            { name: "Arrow Volley", type: "mono", dice: "3d12+12" }
        ],
        attack: "1d12+8",
        spellSlots: 4
    },
    {
        name: "Dave",
        hp: 85,
        passives: ["Fly"],
        attack: "Poke 1d8+4"
    },
    {
        name: "Spheras Nightmare",
        hp: 105,
        passives: ["Poison Breath (cone 1d2 poison or 1d12+8 toxic)"],
        attack: "1d8+4",
        spellSlots: 10
    },
    {
        name: "Dream Hunter",
        hp: 110,
        passives: ["Each bolt adds 1d10 corruption"],
        spells: [
            { name: "Hat Form", type: "react", desc: "Insta dodge mono, half aoe" },
            { name: "Chain's of Damnation Wall", dice: "3d20hp", desc: "Create a wall" }
        ],
        attack: "1d8+4",
        spellSlots: 6
    },
    {
        name: "Astrid Nightmare",
        hp: 130,
        passives: ["Toxic Daggers (1d1 poison or 1d12)"],
        spells: [
            { name: "Shadow Dragon", type: "mono", dice: "2d12+1d8+1d6+4" },
            { name: "Shadow Dash", type: "react", desc: "Dash to target, oport atk" }
        ],
        attack: "Daggers 2d8+6",
        spellSlots: 7
    },
    {
        name: "Sylvanas Nightmare",
        hp: 130,
        passives: ["Banshee (adv def roll)", "Fly"],
        spells: [
            { name: "Chain of Damnation", type: "mono", effect: "bind target root" }
        ],
        abilities: [
            { name: "Scream of the Banshee", type: "cone", dice: "2d12+8", effect: "1d2 stun" }
        ],
        attack: "1d12+4",
        spellSlots: 6
    },
    {
        name: "Akir",
        hp: 55,
        spells: [
            { name: "Gravity Up", desc: "mono dis roll" },
            { name: "Gravity Down", desc: "mono adv roll" }
        ],
        attack: "Punch 1d4",
        spellSlots: 5
    },
    {
        name: "Babacool",
        hp: 50,
        spells: [
            { name: "Tree", type: "instant", desc: "Block" },
            { name: "Roses", dice: "1d6", effect: "1d2 root, 1d2 toxic" },
            { name: "Leaf Cutter", type: "mono", dice: "1d12+6" }
        ],
        attack: "1d8",
        spellSlots: 5
    },
    {
        name: "MaracachaCoocaracha",
        hp: 50,
        spells: [
            { name: "Fiesta", type: "aoe", effect: "1d2 dance stun" },
            { name: "Music of Freedom", type: "aoe", desc: "Remove debuff" },
            { name: "Rocks", desc: "Adv next roll, +1d12 dam" },
            { name: "Vicious Mockery", type: "mono/aoe", dice: "2d???" }
        ],
        attack: "Punch 1d4",
        spellSlots: 6
    },
    {
        name: "Vayl-Soran",
        hp: 65,
        ki: 15,
        kiRegen: 5,
        passives: [
            "Heavenly Champion (+2 all rolls)", 
            "Phoenix Heart (regain 2d20 HP if below half, 1/fight)", 
            "Divine Body (+5 Ki max)", 
            "Lightning Reflexes (+5 Init)"
        ],
        abilities: [
            { name: "Lightning Flicker", type: "react", cost: "3 Ki", desc: "Insta dodge mono or half aoe" },
            { name: "Jade Emperor’s Palm", type: "technique", cost: "4 Ki", dice: "1d12+8", effect: "1d2 para" },
            { name: "Wukong’s Swift Strike", type: "technique", cooldown: "2T", dice: "5d6" },
            { name: "Rising Phoenix Kick", type: "technique", cooldown: "3T", dice: "1d20+10", desc: "Guard breaker" }
        ],
        spells: [
            { name: "Nuwa’s Restauration", type: "sustain", cost: "5 Ki", dice: "1d10+10 HP", desc: "Purge debuffs" },
            { name: "Thunder God’s Roar", type: "aoe", cost: "8 Ki", dice: "3d8+4", effect: "Knockback" }
        ],
        relics: [
            { 
                name: "Tambours de Kamowakeikazuchi", 
                authority: 7, 
                desc: "Passive: 3 charges for lightning explosion. Active: Divine storm.", 
                dice: "4d12 aoe", 
                effect: "Silence 1d2 tours" 
            }
        ],
        attack: "Lightning God Martial Arts: 1d12+6 phy + 1d6 lightning (Advantage)"
    },
    {
        name: "Cole Climber",
        hp: 70,
        spellSlots: 4,
        passives: ["Armored (+2 saving throw)", "Heavy Striker (+1d4+1 dam with heavy weapons)"],
        forms: [
            {
                name: "Earth Dragon",
                hpBonus: 20,
                effects: ["Fly", "Lose Armored", "1 Dragon Spell slot"],
                spells: [
                    { name: "Magma Breath", type: "cone", dice: "2d12+8 fire/earth", effect: "1d2 burn (1d4/t)" }
                ],
                attack: "Dragon Claws: 1d12+1d8+4, guard breaker"
            }
        ],
        spells: [
            { name: "Earth Spike", type: "cone", dice: "1d20+1d6+6" },
            { name: "Stone Skin", type: "react", desc: "10 flat dam reduction", duration: "3T" },
            { name: "Quake Wave", type: "aoe", dice: "2d8+5", effect: "1d2 dis" }
        ],
        abilities: [
            { name: "Spinzutsu", type: "technique", cooldown: "1T", dice: "1d8 aoe" },
            { name: "Dragon Form", type: "transformation", limit: "1/fight", duration: "4T" }
        ],
        attack: "Heavy Power Hammer: 1d12+6 (1d2 stun)"
    },
    {
        name: "Oslo",
        hp: 75,
        spellSlots: 9,
        passives: [
            "Swamp Tribe (Immune to toxic damage)", 
            "Odin's Blessing (+5 Init & Perception)", 
            "Bone Armor (+4 saving throw, regrow 2T if lost)"
        ],
        spells: [
            { name: "Bone Prison", type: "mono", dice: "1d10 piercing", effect: "Root 1d2 turns" },
            { name: "Skeletal Wall", type: "block", dice: "40 HP wall" },
            { name: "Marrow Spear", type: "projectile", dice: "1d20", desc: "Ignores 50% armor" }
        ],
        abilities: [
            { name: "Bone Shatter", type: "aoe", cooldown: "2T", dice: "2d8+4", desc: "Knockback, loose Bone Armor" }
        ],
        attack: "Swamp Serpent Blade: 1d12+4 phy + 1d2 chance to poison (Poison: 1d4 toxic/t)"
    }
];
