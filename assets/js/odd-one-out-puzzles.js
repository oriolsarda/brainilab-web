/* BrainiLab Odd One Out local fallback — V41.8.0 */
window.BrainiOddOneOutPuzzles=(function(){
  const PUZZLES=[
    {id:"ooo-fruit-veg",category:"general",prompt:"Which one does not belong?",items:["Apple","Banana","Mango","Carrot"],odd:3,explanation:"Carrot is a vegetable; the others are fruits."},
    {id:"ooo-rivers-mountain",category:"geography",prompt:"Which one does not belong?",items:["Nile","Amazon","Yangtze","Everest"],odd:3,explanation:"Everest is a mountain; the others are rivers."},
    {id:"ooo-code-software",category:"technology",prompt:"Which one does not belong?",items:["Python","Java","Ruby","Photoshop"],odd:3,explanation:"Photoshop is image-editing software; the others are programming languages."},
    {id:"ooo-capitals",category:"geography",prompt:"Which one does not belong?",items:["Madrid","Rome","Lisbon","Barcelona"],odd:3,explanation:"Barcelona is not a national capital; the others are."},
    {id:"ooo-metals",category:"science",prompt:"Which one does not belong?",items:["Gold","Silver","Copper","Oxygen"],odd:3,explanation:"Oxygen is a non-metal; the others are metals."},
    {id:"ooo-artists",category:"culture",prompt:"Which one does not belong?",items:["Picasso","Monet","Van Gogh","Beethoven"],odd:3,explanation:"Beethoven was primarily a composer; the others are painters."},
    {id:"ooo-racket-sports",category:"sports",prompt:"Which one does not belong?",items:["Tennis","Badminton","Squash","Basketball"],odd:3,explanation:"Basketball is not a racket sport."},
    {id:"ooo-planets-moon",category:"science",prompt:"Which one does not belong?",items:["Saturn","Jupiter","Neptune","Europa"],odd:3,explanation:"Europa is a moon of Jupiter; the others are planets."},
    {id:"ooo-writers-composer",category:"literature",prompt:"Which one does not belong?",items:["Shakespeare","Dickens","Austen","Mozart"],odd:3,explanation:"Mozart was a composer; the others are writers."},
    {id:"ooo-asian-cities",category:"geography",prompt:"Which one does not belong?",items:["Tokyo","Seoul","Beijing","Sydney"],odd:3,explanation:"Sydney is in Australia; the others are major East Asian capitals."},
    {id:"ooo-units",category:"science",prompt:"Which one does not belong?",items:["Celsius","Kelvin","Fahrenheit","Kilogram"],odd:3,explanation:"Kilogram measures mass; the others are temperature scales."},
    {id:"ooo-birds",category:"nature",prompt:"Which one does not belong?",items:["Eagle","Falcon","Hawk","Dolphin"],odd:3,explanation:"Dolphin is a mammal; the others are birds of prey."},
    {id:"ooo-web-tech",category:"technology",prompt:"Which one does not belong?",items:["HTML","CSS","JavaScript","PostgreSQL"],odd:3,explanation:"PostgreSQL is a database system; the others are core web-front-end technologies."},
    {id:"ooo-europe",category:"geography",prompt:"Which one does not belong?",items:["France","Germany","Italy","Brazil"],odd:3,explanation:"Brazil is in South America; the others are European countries."},
    {id:"ooo-shapes",category:"math",prompt:"Which one does not belong?",items:["Triangle","Square","Pentagon","Sphere"],odd:3,explanation:"Sphere is three-dimensional; the others are two-dimensional polygons."},
    {id:"ooo-space",category:"science",prompt:"Which one does not belong?",items:["Mars","Venus","Jupiter","Europa"],odd:3,explanation:"Europa is a moon; the others are planets."},
    {id:"ooo-landforms",category:"geography",prompt:"Which one does not belong?",items:["Asia","Africa","Europe","Sahara"],odd:3,explanation:"Sahara is a desert; the others are continents."},
    {id:"ooo-team-sports",category:"sports",prompt:"Which one does not belong?",items:["Football","Basketball","Volleyball","Chess"],odd:3,explanation:"Chess is not normally played as a team ball sport."},
    {id:"ooo-scientists",category:"science",prompt:"Which one does not belong?",items:["Newton","Einstein","Curie","Shakespeare"],odd:3,explanation:"Shakespeare was a playwright; the others are famous scientists."},
    {id:"ooo-instruments",category:"music",prompt:"Which one does not belong?",items:["Violin","Cello","Guitar","Trumpet"],odd:3,explanation:"Trumpet is a brass wind instrument; the others are string instruments."}
  ];
  return {all:()=>JSON.parse(JSON.stringify(PUZZLES))};
})();
