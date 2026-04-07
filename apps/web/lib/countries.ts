/** ISO 3166-1 alpha-2 country list with names and major cities */

export type Country = {
  code: string;
  name: string;
  cities: string[];
};

export const COUNTRIES: Country[] = [
  { code: "AF", name: "Afghanistan", cities: ["Kabul", "Herat", "Mazar-i-Sharif"] },
  { code: "AL", name: "Albania", cities: ["Tirana", "Durres", "Vlore"] },
  { code: "DZ", name: "Algeria", cities: ["Algiers", "Oran", "Constantine"] },
  { code: "AD", name: "Andorra", cities: ["Andorra la Vella"] },
  { code: "AO", name: "Angola", cities: ["Luanda", "Huambo", "Lobito"] },
  { code: "AG", name: "Antigua and Barbuda", cities: ["St. John's"] },
  { code: "AR", name: "Argentina", cities: ["Buenos Aires", "Cordoba", "Rosario", "Mendoza"] },
  { code: "AM", name: "Armenia", cities: ["Yerevan", "Gyumri"] },
  {
    code: "AU",
    name: "Australia",
    cities: ["Sydney", "Melbourne", "Brisbane", "Perth", "Adelaide", "Gold Coast", "Cairns"]
  },
  { code: "AT", name: "Austria", cities: ["Vienna", "Salzburg", "Innsbruck", "Graz"] },
  { code: "AZ", name: "Azerbaijan", cities: ["Baku", "Ganja"] },
  { code: "BS", name: "Bahamas", cities: ["Nassau", "Freeport"] },
  { code: "BH", name: "Bahrain", cities: ["Manama", "Muharraq", "Riffa"] },
  { code: "BD", name: "Bangladesh", cities: ["Dhaka", "Chittagong", "Sylhet"] },
  { code: "BB", name: "Barbados", cities: ["Bridgetown"] },
  { code: "BY", name: "Belarus", cities: ["Minsk", "Gomel", "Brest"] },
  { code: "BE", name: "Belgium", cities: ["Brussels", "Antwerp", "Bruges", "Ghent"] },
  { code: "BZ", name: "Belize", cities: ["Belmopan", "Belize City"] },
  { code: "BJ", name: "Benin", cities: ["Porto-Novo", "Cotonou"] },
  { code: "BT", name: "Bhutan", cities: ["Thimphu", "Paro"] },
  { code: "BO", name: "Bolivia", cities: ["La Paz", "Santa Cruz", "Sucre"] },
  { code: "BA", name: "Bosnia and Herzegovina", cities: ["Sarajevo", "Mostar"] },
  { code: "BW", name: "Botswana", cities: ["Gaborone", "Maun", "Kasane"] },
  {
    code: "BR",
    name: "Brazil",
    cities: ["Sao Paulo", "Rio de Janeiro", "Brasilia", "Salvador", "Florianopolis", "Recife"]
  },
  { code: "BN", name: "Brunei", cities: ["Bandar Seri Begawan"] },
  { code: "BG", name: "Bulgaria", cities: ["Sofia", "Plovdiv", "Varna"] },
  { code: "BF", name: "Burkina Faso", cities: ["Ouagadougou", "Bobo-Dioulasso"] },
  { code: "BI", name: "Burundi", cities: ["Bujumbura", "Gitega"] },
  { code: "KH", name: "Cambodia", cities: ["Phnom Penh", "Siem Reap", "Sihanoukville"] },
  { code: "CM", name: "Cameroon", cities: ["Yaounde", "Douala"] },
  {
    code: "CA",
    name: "Canada",
    cities: ["Toronto", "Vancouver", "Montreal", "Calgary", "Ottawa", "Whistler"]
  },
  { code: "CV", name: "Cape Verde", cities: ["Praia", "Mindelo"] },
  { code: "CF", name: "Central African Republic", cities: ["Bangui"] },
  { code: "TD", name: "Chad", cities: ["N'Djamena"] },
  { code: "CL", name: "Chile", cities: ["Santiago", "Valparaiso", "Punta Arenas"] },
  {
    code: "CN",
    name: "China",
    cities: [
      "Beijing",
      "Shanghai",
      "Guangzhou",
      "Shenzhen",
      "Chengdu",
      "Hong Kong",
      "Macau",
      "Hangzhou",
      "Xi'an"
    ]
  },
  { code: "CO", name: "Colombia", cities: ["Bogota", "Medellin", "Cartagena", "Cali"] },
  { code: "KM", name: "Comoros", cities: ["Moroni"] },
  { code: "CG", name: "Congo", cities: ["Brazzaville", "Pointe-Noire"] },
  { code: "CD", name: "Congo (DRC)", cities: ["Kinshasa", "Lubumbashi"] },
  { code: "CR", name: "Costa Rica", cities: ["San Jose", "Liberia", "Tamarindo"] },
  { code: "CI", name: "Cote d'Ivoire", cities: ["Abidjan", "Yamoussoukro"] },
  { code: "HR", name: "Croatia", cities: ["Zagreb", "Dubrovnik", "Split", "Rovinj"] },
  { code: "CU", name: "Cuba", cities: ["Havana", "Varadero", "Santiago de Cuba"] },
  { code: "CY", name: "Cyprus", cities: ["Nicosia", "Limassol", "Paphos", "Larnaca"] },
  { code: "CZ", name: "Czech Republic", cities: ["Prague", "Brno", "Karlovy Vary"] },
  { code: "DK", name: "Denmark", cities: ["Copenhagen", "Aarhus", "Odense"] },
  { code: "DJ", name: "Djibouti", cities: ["Djibouti City"] },
  { code: "DM", name: "Dominica", cities: ["Roseau"] },
  { code: "DO", name: "Dominican Republic", cities: ["Santo Domingo", "Punta Cana", "La Romana"] },
  { code: "EC", name: "Ecuador", cities: ["Quito", "Guayaquil", "Cuenca"] },
  {
    code: "EG",
    name: "Egypt",
    cities: ["Cairo", "Alexandria", "Hurghada", "Sharm El Sheikh", "Luxor", "Aswan"]
  },
  { code: "SV", name: "El Salvador", cities: ["San Salvador"] },
  { code: "GQ", name: "Equatorial Guinea", cities: ["Malabo"] },
  { code: "ER", name: "Eritrea", cities: ["Asmara"] },
  { code: "EE", name: "Estonia", cities: ["Tallinn", "Tartu"] },
  { code: "SZ", name: "Eswatini", cities: ["Mbabane", "Manzini"] },
  { code: "ET", name: "Ethiopia", cities: ["Addis Ababa", "Dire Dawa"] },
  { code: "FJ", name: "Fiji", cities: ["Suva", "Nadi"] },
  { code: "FI", name: "Finland", cities: ["Helsinki", "Tampere", "Rovaniemi"] },
  {
    code: "FR",
    name: "France",
    cities: ["Paris", "Nice", "Lyon", "Marseille", "Bordeaux", "Cannes", "Strasbourg"]
  },
  { code: "GA", name: "Gabon", cities: ["Libreville"] },
  { code: "GM", name: "Gambia", cities: ["Banjul"] },
  { code: "GE", name: "Georgia", cities: ["Tbilisi", "Batumi"] },
  {
    code: "DE",
    name: "Germany",
    cities: ["Berlin", "Munich", "Frankfurt", "Hamburg", "Dusseldorf", "Cologne", "Stuttgart"]
  },
  { code: "GH", name: "Ghana", cities: ["Accra", "Kumasi", "Tamale"] },
  {
    code: "GR",
    name: "Greece",
    cities: ["Athens", "Thessaloniki", "Santorini", "Mykonos", "Crete", "Rhodes"]
  },
  { code: "GD", name: "Grenada", cities: ["St. George's"] },
  { code: "GT", name: "Guatemala", cities: ["Guatemala City", "Antigua Guatemala"] },
  { code: "GN", name: "Guinea", cities: ["Conakry"] },
  { code: "GW", name: "Guinea-Bissau", cities: ["Bissau"] },
  { code: "GY", name: "Guyana", cities: ["Georgetown"] },
  { code: "HT", name: "Haiti", cities: ["Port-au-Prince"] },
  { code: "HN", name: "Honduras", cities: ["Tegucigalpa", "Roatan"] },
  { code: "HU", name: "Hungary", cities: ["Budapest", "Debrecen"] },
  { code: "IS", name: "Iceland", cities: ["Reykjavik"] },
  {
    code: "IN",
    name: "India",
    cities: [
      "Mumbai",
      "New Delhi",
      "Bangalore",
      "Chennai",
      "Kolkata",
      "Hyderabad",
      "Goa",
      "Jaipur",
      "Udaipur"
    ]
  },
  {
    code: "ID",
    name: "Indonesia",
    cities: ["Jakarta", "Bali", "Surabaya", "Yogyakarta", "Lombok"]
  },
  { code: "IR", name: "Iran", cities: ["Tehran", "Isfahan", "Shiraz"] },
  { code: "IQ", name: "Iraq", cities: ["Baghdad", "Erbil", "Basra"] },
  { code: "IE", name: "Ireland", cities: ["Dublin", "Cork", "Galway", "Limerick"] },
  { code: "IL", name: "Israel", cities: ["Tel Aviv", "Jerusalem", "Haifa", "Eilat"] },
  {
    code: "IT",
    name: "Italy",
    cities: ["Rome", "Milan", "Florence", "Venice", "Naples", "Amalfi", "Lake Como", "Turin"]
  },
  { code: "JM", name: "Jamaica", cities: ["Kingston", "Montego Bay", "Ocho Rios"] },
  {
    code: "JP",
    name: "Japan",
    cities: ["Tokyo", "Osaka", "Kyoto", "Okinawa", "Hakone", "Sapporo", "Hiroshima"]
  },
  { code: "JO", name: "Jordan", cities: ["Amman", "Aqaba", "Petra", "Dead Sea"] },
  { code: "KZ", name: "Kazakhstan", cities: ["Almaty", "Astana"] },
  {
    code: "KE",
    name: "Kenya",
    cities: ["Nairobi", "Mombasa", "Diani Beach", "Malindi", "Naivasha"]
  },
  { code: "KI", name: "Kiribati", cities: ["Tarawa"] },
  { code: "KW", name: "Kuwait", cities: ["Kuwait City"] },
  { code: "KG", name: "Kyrgyzstan", cities: ["Bishkek"] },
  { code: "LA", name: "Laos", cities: ["Vientiane", "Luang Prabang"] },
  { code: "LV", name: "Latvia", cities: ["Riga", "Jurmala"] },
  { code: "LB", name: "Lebanon", cities: ["Beirut", "Byblos", "Baalbek"] },
  { code: "LS", name: "Lesotho", cities: ["Maseru"] },
  { code: "LR", name: "Liberia", cities: ["Monrovia"] },
  { code: "LY", name: "Libya", cities: ["Tripoli", "Benghazi"] },
  { code: "LI", name: "Liechtenstein", cities: ["Vaduz"] },
  { code: "LT", name: "Lithuania", cities: ["Vilnius", "Kaunas"] },
  { code: "LU", name: "Luxembourg", cities: ["Luxembourg City"] },
  { code: "MG", name: "Madagascar", cities: ["Antananarivo", "Nosy Be"] },
  { code: "MW", name: "Malawi", cities: ["Lilongwe", "Blantyre"] },
  {
    code: "MY",
    name: "Malaysia",
    cities: ["Kuala Lumpur", "Penang", "Langkawi", "Kota Kinabalu", "Johor Bahru"]
  },
  { code: "MV", name: "Maldives", cities: ["Male", "Maafushi", "Hulhumale"] },
  { code: "ML", name: "Mali", cities: ["Bamako", "Timbuktu"] },
  { code: "MT", name: "Malta", cities: ["Valletta", "Sliema", "St. Julian's"] },
  { code: "MH", name: "Marshall Islands", cities: ["Majuro"] },
  { code: "MR", name: "Mauritania", cities: ["Nouakchott"] },
  { code: "MU", name: "Mauritius", cities: ["Port Louis", "Grand Baie", "Flic en Flac"] },
  {
    code: "MX",
    name: "Mexico",
    cities: [
      "Mexico City",
      "Cancun",
      "Playa del Carmen",
      "Los Cabos",
      "Riviera Maya",
      "Puerto Vallarta"
    ]
  },
  { code: "FM", name: "Micronesia", cities: ["Palikir"] },
  { code: "MD", name: "Moldova", cities: ["Chisinau"] },
  { code: "MC", name: "Monaco", cities: ["Monte Carlo"] },
  { code: "MN", name: "Mongolia", cities: ["Ulaanbaatar"] },
  { code: "ME", name: "Montenegro", cities: ["Podgorica", "Budva", "Kotor"] },
  {
    code: "MA",
    name: "Morocco",
    cities: ["Marrakech", "Casablanca", "Fez", "Rabat", "Tangier", "Agadir"]
  },
  { code: "MZ", name: "Mozambique", cities: ["Maputo", "Vilankulo"] },
  { code: "MM", name: "Myanmar", cities: ["Yangon", "Mandalay", "Bagan"] },
  { code: "NA", name: "Namibia", cities: ["Windhoek", "Swakopmund"] },
  { code: "NR", name: "Nauru", cities: ["Yaren"] },
  { code: "NP", name: "Nepal", cities: ["Kathmandu", "Pokhara"] },
  { code: "NL", name: "Netherlands", cities: ["Amsterdam", "Rotterdam", "The Hague", "Utrecht"] },
  {
    code: "NZ",
    name: "New Zealand",
    cities: ["Auckland", "Wellington", "Queenstown", "Christchurch", "Rotorua"]
  },
  { code: "NI", name: "Nicaragua", cities: ["Managua", "Granada"] },
  { code: "NE", name: "Niger", cities: ["Niamey"] },
  { code: "NG", name: "Nigeria", cities: ["Lagos", "Abuja", "Port Harcourt"] },
  { code: "KP", name: "North Korea", cities: ["Pyongyang"] },
  { code: "MK", name: "North Macedonia", cities: ["Skopje", "Ohrid"] },
  { code: "NO", name: "Norway", cities: ["Oslo", "Bergen", "Tromso", "Stavanger"] },
  { code: "OM", name: "Oman", cities: ["Muscat", "Salalah", "Nizwa"] },
  { code: "PK", name: "Pakistan", cities: ["Karachi", "Lahore", "Islamabad"] },
  { code: "PW", name: "Palau", cities: ["Ngerulmud"] },
  { code: "PA", name: "Panama", cities: ["Panama City", "Bocas del Toro"] },
  { code: "PG", name: "Papua New Guinea", cities: ["Port Moresby"] },
  { code: "PY", name: "Paraguay", cities: ["Asuncion"] },
  { code: "PE", name: "Peru", cities: ["Lima", "Cusco", "Arequipa"] },
  { code: "PH", name: "Philippines", cities: ["Manila", "Cebu", "Boracay", "Palawan", "Siargao"] },
  { code: "PL", name: "Poland", cities: ["Warsaw", "Krakow", "Gdansk", "Wroclaw"] },
  { code: "PT", name: "Portugal", cities: ["Lisbon", "Porto", "Algarve", "Funchal", "Cascais"] },
  { code: "QA", name: "Qatar", cities: ["Doha", "Lusail", "Al Wakrah", "The Pearl"] },
  { code: "RO", name: "Romania", cities: ["Bucharest", "Cluj-Napoca", "Brasov"] },
  { code: "RU", name: "Russia", cities: ["Moscow", "St. Petersburg", "Sochi", "Kazan"] },
  { code: "RW", name: "Rwanda", cities: ["Kigali", "Volcanoes NP"] },
  { code: "KN", name: "Saint Kitts and Nevis", cities: ["Basseterre"] },
  { code: "LC", name: "Saint Lucia", cities: ["Castries", "Soufriere"] },
  { code: "VC", name: "Saint Vincent", cities: ["Kingstown"] },
  { code: "WS", name: "Samoa", cities: ["Apia"] },
  { code: "SM", name: "San Marino", cities: ["San Marino"] },
  { code: "ST", name: "Sao Tome and Principe", cities: ["Sao Tome"] },
  {
    code: "SA",
    name: "Saudi Arabia",
    cities: ["Riyadh", "Jeddah", "Mecca", "Medina", "NEOM", "AlUla"]
  },
  { code: "SN", name: "Senegal", cities: ["Dakar", "Saint-Louis"] },
  { code: "RS", name: "Serbia", cities: ["Belgrade", "Novi Sad"] },
  { code: "SC", name: "Seychelles", cities: ["Victoria", "Mahe", "Praslin"] },
  { code: "SL", name: "Sierra Leone", cities: ["Freetown"] },
  { code: "SG", name: "Singapore", cities: ["Singapore", "Sentosa"] },
  { code: "SK", name: "Slovakia", cities: ["Bratislava", "Kosice"] },
  { code: "SI", name: "Slovenia", cities: ["Ljubljana", "Bled", "Portoroz"] },
  { code: "SB", name: "Solomon Islands", cities: ["Honiara"] },
  { code: "SO", name: "Somalia", cities: ["Mogadishu"] },
  {
    code: "ZA",
    name: "South Africa",
    cities: ["Cape Town", "Johannesburg", "Durban", "Kruger NP", "Stellenbosch"]
  },
  { code: "KR", name: "South Korea", cities: ["Seoul", "Busan", "Jeju", "Incheon"] },
  { code: "SS", name: "South Sudan", cities: ["Juba"] },
  {
    code: "ES",
    name: "Spain",
    cities: [
      "Madrid",
      "Barcelona",
      "Seville",
      "Malaga",
      "Valencia",
      "Ibiza",
      "Marbella",
      "Tenerife"
    ]
  },
  { code: "LK", name: "Sri Lanka", cities: ["Colombo", "Kandy", "Galle", "Negombo"] },
  { code: "SD", name: "Sudan", cities: ["Khartoum"] },
  { code: "SR", name: "Suriname", cities: ["Paramaribo"] },
  { code: "SE", name: "Sweden", cities: ["Stockholm", "Gothenburg", "Malmo"] },
  {
    code: "CH",
    name: "Switzerland",
    cities: ["Zurich", "Geneva", "Basel", "Lucerne", "Interlaken", "Zermatt"]
  },
  { code: "SY", name: "Syria", cities: ["Damascus", "Aleppo"] },
  { code: "TW", name: "Taiwan", cities: ["Taipei", "Kaohsiung"] },
  { code: "TJ", name: "Tajikistan", cities: ["Dushanbe"] },
  {
    code: "TZ",
    name: "Tanzania",
    cities: ["Dar es Salaam", "Arusha", "Zanzibar", "Dodoma", "Moshi", "Ngorongoro"]
  },
  {
    code: "TH",
    name: "Thailand",
    cities: ["Bangkok", "Phuket", "Chiang Mai", "Pattaya", "Koh Samui", "Krabi", "Hua Hin"]
  },
  { code: "TL", name: "Timor-Leste", cities: ["Dili"] },
  { code: "TG", name: "Togo", cities: ["Lome"] },
  { code: "TO", name: "Tonga", cities: ["Nuku'alofa"] },
  { code: "TT", name: "Trinidad and Tobago", cities: ["Port of Spain", "Tobago"] },
  { code: "TN", name: "Tunisia", cities: ["Tunis", "Hammamet", "Djerba", "Sousse"] },
  {
    code: "TR",
    name: "Turkey",
    cities: ["Istanbul", "Antalya", "Bodrum", "Cappadocia", "Ankara", "Izmir"]
  },
  { code: "TM", name: "Turkmenistan", cities: ["Ashgabat"] },
  { code: "TV", name: "Tuvalu", cities: ["Funafuti"] },
  { code: "UG", name: "Uganda", cities: ["Kampala", "Entebbe"] },
  { code: "UA", name: "Ukraine", cities: ["Kyiv", "Lviv", "Odesa"] },
  {
    code: "AE",
    name: "United Arab Emirates",
    cities: ["Dubai", "Abu Dhabi", "Sharjah", "Ras Al Khaimah", "Fujairah", "Ajman"]
  },
  {
    code: "GB",
    name: "United Kingdom",
    cities: [
      "London",
      "Edinburgh",
      "Manchester",
      "Birmingham",
      "Liverpool",
      "Bath",
      "Oxford",
      "Cambridge"
    ]
  },
  {
    code: "US",
    name: "United States",
    cities: [
      "New York",
      "Los Angeles",
      "Miami",
      "Las Vegas",
      "San Francisco",
      "Chicago",
      "Orlando",
      "Honolulu",
      "Washington DC",
      "Boston",
      "Nashville",
      "New Orleans"
    ]
  },
  { code: "UY", name: "Uruguay", cities: ["Montevideo", "Punta del Este"] },
  { code: "UZ", name: "Uzbekistan", cities: ["Tashkent", "Samarkand", "Bukhara"] },
  { code: "VU", name: "Vanuatu", cities: ["Port Vila"] },
  { code: "VA", name: "Vatican City", cities: ["Vatican City"] },
  { code: "VE", name: "Venezuela", cities: ["Caracas", "Margarita Island"] },
  {
    code: "VN",
    name: "Vietnam",
    cities: ["Ho Chi Minh City", "Hanoi", "Da Nang", "Hoi An", "Phu Quoc", "Nha Trang"]
  },
  { code: "YE", name: "Yemen", cities: ["Sana'a", "Aden"] },
  { code: "ZM", name: "Zambia", cities: ["Lusaka", "Livingstone"] },
  { code: "ZW", name: "Zimbabwe", cities: ["Harare", "Victoria Falls", "Bulawayo"] }
];

/** Lookup map by country code */
export const COUNTRY_MAP = new Map(COUNTRIES.map((c) => [c.code, c]));

/** Get cities for a country code */
export function getCitiesForCountry(code: string): string[] {
  return COUNTRY_MAP.get(code)?.cities ?? [];
}
