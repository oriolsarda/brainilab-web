/* BrainiLab Higher or Lower local fallback — V41.8.0 */
window.BrainiHigherLowerPairs=(function(){
  const PAIRS=[
    {id:"hl-everest-k2",category:"geography",comparisonType:"higher_lower",metric:"Height",left:"Mount Everest",leftValue:8849,right:"K2",rightValue:8611,unit:"m",explanation:"Everest is about 8,849 m high; K2 is about 8,611 m."},
    {id:"hl-earth-mars",category:"science",comparisonType:"bigger_smaller",metric:"Diameter",left:"Earth",leftValue:12742,right:"Mars",rightValue:6779,unit:"km",explanation:"Earth is almost twice Mars's diameter."},
    {id:"hl-jupiter-saturn",category:"science",comparisonType:"bigger_smaller",metric:"Equatorial diameter",left:"Jupiter",leftValue:142984,right:"Saturn",rightValue:120536,unit:"km",explanation:"Jupiter is larger than Saturn by diameter."},
    {id:"hl-canada-china",category:"geography",comparisonType:"bigger_smaller",metric:"Total area",left:"Canada",leftValue:9984670,right:"China",rightValue:9596961,unit:"km²",explanation:"Canada has a slightly larger total area than China."},
    {id:"hl-australia-india",category:"geography",comparisonType:"bigger_smaller",metric:"Total area",left:"Australia",leftValue:7692024,right:"India",rightValue:3287263,unit:"km²",explanation:"Australia is more than twice India's area."},
    {id:"hl-light-sound",category:"science",comparisonType:"faster_slower",metric:"Speed",left:"Light in vacuum",leftValue:299792458,right:"Sound in air",rightValue:343,unit:"m/s",explanation:"Light is vastly faster than sound."},
    {id:"hl-water-iron",category:"science",comparisonType:"higher_lower",metric:"Temperature",left:"Water boiling point",leftValue:100,right:"Iron melting point",rightValue:1538,unit:"°C",explanation:"Iron melts at a far higher temperature than water boils."},
    {id:"hl-pacific-atlantic",category:"geography",comparisonType:"bigger_smaller",metric:"Surface area",left:"Pacific Ocean",leftValue:165250000,right:"Atlantic Ocean",rightValue:106460000,unit:"km²",explanation:"The Pacific is the world's largest ocean."},
    {id:"hl-venus-mercury",category:"science",comparisonType:"hotter_colder",metric:"Average surface temperature",left:"Venus",leftValue:464,right:"Mercury",rightValue:167,unit:"°C",explanation:"Venus is hotter on average because of its dense greenhouse atmosphere."},
    {id:"hl-moon-iss",category:"science",comparisonType:"farther_closer",metric:"Distance from Earth's surface",left:"the Moon",leftValue:384400,right:"the ISS",rightValue:400,unit:"km",explanation:"The Moon is hundreds of thousands of kilometres away; the ISS orbits a few hundred kilometres up."},
    {id:"hl-titanic-moon",category:"history",comparisonType:"earlier_later",metric:"Year",left:"the Titanic sinking",leftValue:1912,right:"the first Moon landing",rightValue:1969,unit:"year",explanation:"Apollo 11 landed on the Moon in 1969, 57 years after Titanic sank."},
    {id:"hl-printing-phone",category:"history",comparisonType:"earlier_later",metric:"Approximate invention year",left:"the Gutenberg printing press",leftValue:1450,right:"the telephone",rightValue:1876,unit:"year",explanation:"The telephone came centuries after Gutenberg's press."},
    {id:"hl-ww2-iphone",category:"history",comparisonType:"earlier_later",metric:"Year",left:"World War II ending",leftValue:1945,right:"the first iPhone release",rightValue:2007,unit:"year",explanation:"The first iPhone was released in 2007."},
    {id:"hl-beethoven-mozart",category:"music",comparisonType:"older_younger",metric:"Birth year",left:"Beethoven",leftValue:1770,right:"Mozart",rightValue:1756,unit:"year",explanation:"Mozart was born 14 years before Beethoven, so Mozart was older."},
    {id:"hl-whale-giraffe",category:"nature",comparisonType:"longer_shorter",metric:"Typical maximum length / height",left:"a blue whale",leftValue:30,right:"a giraffe",rightValue:5.5,unit:"m",explanation:"A blue whale can reach around 30 m; a giraffe is roughly 5–6 m tall."},
    {id:"hl-cheetah-lion",category:"nature",comparisonType:"faster_slower",metric:"Top speed",left:"a cheetah",leftValue:120,right:"a lion",rightValue:80,unit:"km/h",explanation:"Cheetahs are the fastest land animals over short distances."},
    {id:"hl-human-chimp",category:"science",comparisonType:"more_less",metric:"chromosomes",left:"a human",leftValue:46,right:"a chimpanzee",rightValue:48,unit:"chromosomes",explanation:"Humans have 46 chromosomes; chimpanzees have 48."},
    {id:"hl-h-he",category:"science",comparisonType:"higher_lower",metric:"Atomic number",left:"Hydrogen",leftValue:1,right:"Helium",rightValue:2,unit:"",explanation:"Hydrogen is element 1 and helium is element 2."},
    {id:"hl-gold-silver",category:"science",comparisonType:"higher_lower",metric:"Atomic number",left:"Gold",leftValue:79,right:"Silver",rightValue:47,unit:"",explanation:"Gold is element 79; silver is element 47."},
    {id:"hl-fuji-montblanc",category:"geography",comparisonType:"higher_lower",metric:"Height",left:"Mount Fuji",leftValue:3776,right:"Mont Blanc",rightValue:4806,unit:"m",explanation:"Mont Blanc is higher than Mount Fuji."}
  ];
  return {all:()=>JSON.parse(JSON.stringify(PAIRS))};
})();
